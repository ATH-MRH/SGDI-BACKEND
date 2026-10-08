"""Adaptateur SMSGate (capcom6/android-sms-gateway) en mode serveur privé ou cloud.

ATLAS n'appelle jamais le téléphone : il parle à l'API « 3rdparty » du serveur SMSGate,
auquel l'application Android se connecte d'elle-même (réseau mobile ou Wi-Fi).
Aucun texte de SMS, numéro ou identifiant n'est journalisé ici.
"""
import hashlib
import hmac
import os
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

WEBHOOK_TOLERANCE = 300
# États SMSGate -> suivi ATLAS. « Pending » = seulement accepté par le serveur de la passerelle.
STATES = {'Pending': 'accepted', 'Processed': 'processed', 'Sent': 'sent', 'Delivered': 'delivered',
          'Failed': 'failed', 'Cancelled': 'failed'}
WEBHOOK_EVENTS = {'sms:sent': 'sent', 'sms:delivered': 'delivered', 'sms:failed': 'failed'}


@dataclass(frozen=True)
class SMSGateConfig:
    api_url: str
    username: str
    password: str
    device_id: str | None = None
    sim_number: int | None = None
    priority: int = 100
    timeout: float = 10.0
    webhook_key: str | None = None


@dataclass(frozen=True)
class GatewayReply:
    # outcome : accepted (pris en charge), retry (issue inconnue ou panne passagère), rejected (définitif)
    outcome: str
    state: str | None = None
    error: str | None = None


def _int(name: str, default: int | None, low: int, high: int) -> int | None:
    raw = os.getenv(name, '').strip()
    if not raw:
        return default
    value = int(raw)
    if not low <= value <= high:
        raise ValueError(name)
    return value


def load_config() -> SMSGateConfig | None:
    """Configuration lue dans l'environnement ; None si elle est absente ou invalide."""
    url = os.getenv('RECRUITMENT_SMSGATE_API_URL', '').strip().rstrip('/')
    username = os.getenv('RECRUITMENT_SMSGATE_USERNAME', '').strip()
    password = os.getenv('RECRUITMENT_SMSGATE_PASSWORD', '')
    parts = urlsplit(url)
    insecure = os.getenv('RECRUITMENT_SMSGATE_ALLOW_HTTP', 'false').lower() == 'true'
    if not parts.hostname or parts.username or not username or not password:
        return None
    # Identifiants en Basic : HTTPS obligatoire, sauf réseau interne explicitement assumé.
    if parts.scheme != 'https' and not (parts.scheme == 'http' and insecure):
        return None
    try:
        return SMSGateConfig(
            api_url=url, username=username, password=password,
            device_id=os.getenv('RECRUITMENT_SMSGATE_DEVICE_ID', '').strip() or None,
            sim_number=_int('RECRUITMENT_SMSGATE_SIM_NUMBER', None, 1, 3),
            priority=_int('RECRUITMENT_SMSGATE_PRIORITY', 100, -128, 127),
            timeout=float(_int('RECRUITMENT_SMSGATE_TIMEOUT_SECONDS', 10, 2, 30)),
            webhook_key=os.getenv('RECRUITMENT_SMSGATE_WEBHOOK_SIGNING_KEY', '') or None)
    except ValueError:
        return None


def verify_webhook(key: str, body: bytes, timestamp: str | None, signature: str | None, now: int) -> bool:
    """Signature SMSGate : HMAC-SHA256(clé, corps brut + X-Timestamp), en hexadécimal."""
    if not key or not timestamp or not signature or not timestamp.isdigit() or len(timestamp) > 12:
        return False
    if abs(now - int(timestamp)) > WEBHOOK_TOLERANCE:
        return False
    expected = hmac.new(key.encode(), body + timestamp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


class SMSGateClient:
    def __init__(self, config: SMSGateConfig, transport: httpx.BaseTransport | None = None):
        self.config = config
        self._transport = transport

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        # Pas de redirection suivie : les identifiants ne partent que vers l'hôte configuré.
        with httpx.Client(auth=(self.config.username, self.config.password), timeout=self.config.timeout,
                          transport=self._transport, follow_redirects=False) as client:
            return client.request(method, self.config.api_url + path, **kwargs)

    @staticmethod
    def _state(response: httpx.Response) -> tuple[str | None, str | None]:
        try:
            data = response.json()
        except ValueError:
            return None, None
        if not isinstance(data, dict):
            return None, None
        recipients = data.get('recipients') if isinstance(data.get('recipients'), list) else []
        error = next((item.get('error') for item in recipients if isinstance(item, dict) and item.get('error')), None)
        return STATES.get(data.get('state')), (str(error)[:100] if error else None)

    def send(self, message_id: str, phone: str, text: str, ttl: int) -> GatewayReply:
        """Dépose un SMS. Le même `message_id` rejoué est refusé (409) par SMSGate : la relance
        après une issue inconnue ne peut donc pas produire un second SMS."""
        body = {'id': message_id, 'phoneNumbers': [phone], 'textMessage': {'text': text}, 'ttl': ttl,
                'withDeliveryReport': True, 'priority': self.config.priority}
        if self.config.device_id:
            body['deviceId'] = self.config.device_id
        if self.config.sim_number:
            body['simNumber'] = self.config.sim_number
        try:
            response = self._request('POST', '/messages', json=body)
        except httpx.TimeoutException:
            return GatewayReply('retry', error='gateway_timeout')
        except httpx.HTTPError:
            return GatewayReply('retry', error='gateway_unreachable')
        code = response.status_code
        if code == 409:
            return GatewayReply('accepted')
        if code in (200, 201, 202):
            state, error = self._state(response)
            if state == 'failed':
                return GatewayReply('rejected', state, error or 'gateway_failed')
            return GatewayReply('accepted', state)
        if code in (408, 425, 429) or code >= 500:
            return GatewayReply('retry', error=f'gateway_http_{code}')
        # 400/401/403/404... : relancer à l'identique ne changera rien.
        return GatewayReply('rejected', error='gateway_auth' if code in (401, 403) else f'gateway_http_{code}')

    def state(self, message_id: str) -> GatewayReply:
        try:
            response = self._request('GET', f'/messages/{message_id}')
        except httpx.HTTPError:
            return GatewayReply('retry', error='gateway_unreachable')
        if response.status_code != 200:
            return GatewayReply('retry', error=f'gateway_http_{response.status_code}')
        state, error = self._state(response)
        return GatewayReply('accepted', state, error) if state else GatewayReply('retry', error='gateway_state_unknown')

    def devices(self) -> list[dict]:
        response = self._request('GET', '/devices')
        response.raise_for_status()
        data = response.json()
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def healthy(self) -> bool:
        """Serveur joignable, identifiants valides et téléphone attendu enregistré.
        Ne prouve pas que le téléphone est en ligne à l'instant (`lastSeen` peut dater de 15 min)."""
        try:
            devices = self.devices()
        except (httpx.HTTPError, ValueError):
            return False
        if self.config.device_id:
            return any(item.get('id') == self.config.device_id for item in devices)
        return bool(devices)

    def register_webhook(self, webhook_id: str, url: str, event: str) -> int:
        body = {'id': webhook_id, 'url': url, 'event': event}
        if self.config.device_id:
            body['device_id'] = self.config.device_id
        return self._request('POST', '/webhooks', json=body).status_code
