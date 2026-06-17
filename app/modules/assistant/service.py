"""Logique metier de l'assistant ATLAS.

Le mode local ne depend d'aucune API payante. Il agit comme un guide metier
contextuel pour les ecrans ATLAS les plus utilises.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.photo_storage import UPLOADS_ROOT


TTS_CACHE_DIR = UPLOADS_ROOT / "tts"
TTS_NETWORK_TIMEOUT_SECONDS = 8


SYSTEM_PROMPT = """Tu es ATLAS Assistant, l'assistant IA integre au systeme ERP ATLAS de gestion RH et de gardiennage.
Tu aides les utilisateurs a naviguer dans le systeme, repondre a leurs questions metier et les guider dans leurs taches.

Le systeme ATLAS comprend les modules suivants :
- DRH : gestion des employes, candidats, contrats, conges, sanctions, fiches de position
- OPS : sites de gardiennage, affectations, pointage, presences, incidents
- MATERIEL : magasins, articles, stock, dotations, mouvements, reversements
- COMMERCIAL : clients, prospects, devis, commandes, livraisons
- FINANCES : factures, paiements, avances, caisse, comptabilite
- REPORTING : tableaux de bord, statistiques, top clients/fournisseurs

Reponds toujours en francais, de maniere concise et professionnelle.
Si la question sort du cadre du systeme ATLAS ou de la gestion RH/securite, reponds poliment que tu es specialise dans ATLAS.
"""


def _norm(text: str) -> str:
    raw = unicodedata.normalize("NFD", text or "")
    raw = "".join(ch for ch in raw if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", raw.lower()).strip()


def _has(text: str, *words: str) -> bool:
    return any(_norm(word) in text for word in words)


def _route(context: dict | None) -> str:
    value = (context or {}).get("route") or ""
    return str(value).replace("#/", "").strip("/")


def _module(context: dict | None, message: str) -> str:
    route = _route(context)
    text = _norm(message)
    module = str((context or {}).get("module") or "").lower()
    if module:
        return module
    if route.startswith(("materiel",)):
        return "materiel"
    if route.startswith(("ops", "sites", "incidents")) or _has(text, "ops", "site", "mission"):
        return "ops"
    if route.startswith(("facturation", "paie")) or _has(text, "finance", "facture", "paiement", "caisse", "paie"):
        return "finances"
    if route.startswith(("commercial",)) or _has(text, "commercial", "client", "prospect", "devis"):
        return "commercial"
    if route.startswith(("secretariat",)) or _has(text, "secretariat", "courrier", "archive"):
        return "secretariat"
    if route.startswith(("admin",)) or _has(text, "administration", "admin", "utilisateur", "droits"):
        return "admin"
    return "drh"


def _screen_hint(context: dict | None) -> str:
    route = _route(context)
    title = str((context or {}).get("title") or "").strip()
    society = str((context or {}).get("societe") or "").strip()
    parts = []
    if title:
        parts.append(f"Vous etes sur l'ecran {title}.")
    elif route:
        parts.append(f"Vous etes sur la route {route}.")
    if society:
        parts.append(f"Societe active : {society}.")
    return " ".join(parts)


def _steps(title: str, items: list[str], context: dict | None = None) -> str:
    prefix = _screen_hint(context)
    body = "\n".join(f"{idx}. {item}" for idx, item in enumerate(items, 1))
    return f"{prefix}\n{title}\n{body}".strip()


def _local_catalog_answer(text: str, context: dict | None) -> str | None:
    module = _module(context, text)
    route = _route(context)

    if _has(text, "connexion", "login", "mot de passe", "postgres", "postgresql", "serveur", "docker"):
        return _steps("Diagnostic connexion / serveur :", [
            "Verifiez que Docker Desktop est bien ouvert et que le moteur Docker est vert.",
            "Dans le dossier SGDI-BACKEND, lancez `docker-compose up -d`.",
            "Attendez que PostgreSQL soit healthy, puis rechargez l'application.",
            "Si ATLAS indique encore PostgreSQL non charge, redemarrez uniquement le conteneur backend.",
        ], context)

    if _has(text, "son", "voix", "parle", "audio", "amelie", "flo"):
        return _steps("Pour retablir la voix ATLAS :", [
            "Cliquez une fois dans la page ATLAS avant de lancer la voix, car le navigateur bloque parfois l'audio sans interaction.",
            "Dans le widget ATLAS, utilisez le bouton Son puis le bouton Voix.",
            "Si Son marche mais Voix ne parle pas, gardez la voix navigateur par defaut ou Flo en francais.",
            "La voix depend du navigateur et de macOS : ATLAS peut choisir la meilleure voix disponible, mais ne peut pas installer une voix absente.",
        ], context)

    if _has(text, "candidat", "reserve", "preselection"):
        return _steps("Regle candidat dans ATLAS :", [
            "Un candidat est une personne preselectionnee et pas encore recrutee.",
            "Des qu'elle devient employee, elle ne doit plus rester dans le compteur candidats.",
            "Pour controler : ouvrez DRH > Candidats/Reserve et verifiez uniquement les profils en attente.",
            "Si le compteur est faux, il faut corriger le statut ou nettoyer les anciens candidats recrutes.",
        ], context)

    if _has(text, "fiche de position", "identite", "coordonnees", "habilitation", "contrat", "sanction"):
        return _steps("Fiche de position :", [
            "Ouvrez DRH > Fiche de position, puis choisissez l'employe.",
            "Utilisez les onglets Identite, Coordonnees, Habilitation, Contrat, Verification, Materiel, Affectation et Sanctions.",
            "Les modifications verrouillees se font depuis Administration systeme.",
            "Pour imprimer, utilisez uniquement les boutons visibles sur la fiche selon vos droits.",
        ], context)

    if _has(text, "doubl", "200", "deux fois", "quantite globale", "quantite recu"):
        return _steps("Controle d'un stock double :", [
            "Verifiez si vous avez rempli a la fois Quantite totale et Quantite par taille.",
            "Si les deux champs sont additionnes, gardez une seule source : soit total simple, soit detail par taille.",
            "Dans l'historique des mouvements, cherchez deux entrees identiques meme date/meme article.",
            "Si une entree est en doublon, supprimez le mouvement en trop depuis Administration systeme si vos droits le permettent.",
        ], context)

    if _has(text, "stock", "magasin", "article", "dotation", "reversement", "taille", "pointure", "numero de serie", "prix unitaire", "habillement"):
        return _steps("Logique materiel correcte :", [
            "Creez ou selectionnez le magasin concerne.",
            "Dans le catalogue, l'article doit etre rattache au magasin et a sa sous-categorie/famille.",
            "Pour une entree stock : saisissez Date reception, Quantite, Prix unitaire, Etat, puis les numeros de serie si l'article en a.",
            "Pour l'habillement, renseignez les quantites par taille ou pointure.",
            "Une dotation deduit le stock du magasin et l'ajoute a l'employe, au site ou a la structure.",
            "Un reversement fait l'inverse : il revient dans le magasin avec son etat reel.",
        ], context)

    if _has(text, "ops", "site", "affectation", "pointage", "presence", "mission", "incident"):
        return _steps("Guide OPS :", [
            "Commencez par verifier que le site existe et qu'il est actif.",
            "Affectez l'agent au site ou a la mission.",
            "Controlez la presence dans Pointage ou Feuille de presence.",
            "Declarez les evenements dans Main courante / Incidents pour garder la trace operationnelle.",
        ], context)

    if _has(text, "facture", "paiement", "caisse", "devis", "finance", "compta", "comptabilite", "paie"):
        return _steps("Guide finances / comptabilite :", [
            "Creez d'abord le document source : devis, facture ou mouvement de caisse.",
            "Enregistrez le paiement avec son mode, sa reference et sa date.",
            "Controlez les restes a payer dans Situation paiements.",
            "Les valeurs chiffrees du materiel doivent etre consultees cote Finances, pas dans l'inventaire materiel.",
        ], context)

    if _has(text, "supprimer", "modifier", "administration", "admin", "catalogue", "utilisateur", "droits"):
        return _steps("Administration systeme :", [
            "Les suppressions sensibles doivent partir d'Administration systeme.",
            "Cochez les lignes concernees, puis utilisez la suppression en lot si elle existe.",
            "Apres modification ou suppression, ATLAS doit recharger les donnees et actualiser les compteurs.",
            "Si l'ecran ne change pas, utilisez Actualiser puis reconnectez-vous si necessaire.",
        ], context)

    if _has(text, "employe", "agent", "drh", "contrat", "conge", "absence", "maladie"):
        return _steps("Guide DRH :", [
            "Pour creer ou modifier un employe, passez par Gestion des effectifs.",
            "Pour le contrat, utilisez Recrutement/Contrat ou l'onglet Contrat de la fiche.",
            "Pour conges, absence, maladie ou suspension, gardez la fiche agent comme source officielle.",
            "La fiche de position sert a consulter la synthese et les documents lies.",
        ], context)

    if _has(text, "commercial", "client", "prospect", "opportunite", "visite"):
        return _steps("Guide commercial :", [
            "Creez d'abord le prospect ou le client.",
            "Suivez l'opportunite et les visites commerciales.",
            "Quand l'accord est pret, passez vers devis puis facturation.",
            "Gardez les informations client propres pour eviter les doublons en finance.",
        ], context)

    if _has(text, "secretariat", "courrier", "note", "archive"):
        return _steps("Guide secretariat :", [
            "Enregistrez les courriers entrants ou sortants dans Courriers.",
            "Utilisez Notes internes pour les communications suivies.",
            "Classez les pieces terminees dans Archives.",
            "Ajoutez une reference claire pour retrouver le document rapidement.",
        ], context)

    if route or module:
        module_labels = {
            "drh": "DRH",
            "ops": "OPS",
            "materiel": "Materiel",
            "finances": "Finances",
            "commercial": "Commercial",
            "secretariat": "Secretariat",
            "admin": "Administration systeme",
        }
        return _steps(f"Je peux vous guider sur {module_labels.get(module, module.upper())}. Dites-moi l'action exacte :", [
            "Creer, modifier, supprimer, imprimer ou verifier un compteur.",
            "Indiquez l'objet concerne : employe, site, article, magasin, facture, contrat, etc.",
            "Si un resultat est faux, donnez le chiffre attendu et le chiffre affiche.",
        ], context)

    return None


def local_atlas_answer(message: str, context: dict | None = None) -> str:
    """Repond aux questions courantes sans appel API externe."""
    text = _norm(message or "")
    if not text:
        return "Ecrivez votre question, par exemple : comment creer une dotation, pourquoi mon stock double, ou comment affecter un agent a un site."

    answer = _local_catalog_answer(text, context)
    if answer:
        return answer

    return (
        "Je suis ATLAS, votre guide metier. Je peux aider sur DRH, OPS, Materiel, "
        "Finances, Commercial, Secretariat et Administration systeme. "
        "Pour une aide utile, formulez l'action et l'objet, par exemple : "
        "`comment doter un employe en tenue`, `pourquoi le compteur candidat est faux`, "
        "ou `comment supprimer un magasin depuis Administration systeme`."
    )


def _tts_cache_path(text: str) -> Path:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return TTS_CACHE_DIR / f"{digest}.mp3"


def _fetch_google_tts(clean: str) -> bytes:
    query = urlencode({"ie": "UTF-8", "client": "tw-ob", "tl": "fr", "q": clean})
    req = Request(
        "https://translate.google.com/translate_tts?" + query,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "audio/mpeg,*/*;q=0.8",
        },
    )
    with urlopen(req, timeout=TTS_NETWORK_TIMEOUT_SECONDS) as response:
        return response.read()


def tts_audio_bytes(text: str) -> bytes:
    """Recupere un court MP3 de synthese vocale francaise.

    Les audios deja produits sont relus depuis un cache local. Si le reseau ou
    le fournisseur TTS tombe, ATLAS peut donc continuer a parler les phrases
    deja entendues au moins une fois.
    """
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        raise ValueError("Texte voix vide")
    clean = clean[:180]
    cache_path = _tts_cache_path(clean)
    if cache_path.exists():
        cached = cache_path.read_bytes()
        if cached:
            return cached

    try:
        data = _fetch_google_tts(clean)
    except Exception:
        if cache_path.exists():
            cached = cache_path.read_bytes()
            if cached:
                return cached
        raise
    if not data:
        raise ValueError("Audio voix vide")
    TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def claude_answer(
    api_key: str,
    message: str,
    history: list[dict],
    context: dict | None = None,
) -> str:
    """Appel a l'API Anthropic Claude. Leve une exception en cas d'erreur."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    messages = list(history[-10:])
    messages.append({"role": "user", "content": message})

    system = SYSTEM_PROMPT
    if context:
        system += (
            f"\nContexte ecran : route={context.get('route') or '-'}, "
            f"societe={context.get('societe') or '-'}, "
            f"module={context.get('module') or '-'}, "
            f"titre={context.get('title') or '-'}."
        )

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system,
        messages=messages,
    )
    return response.content[0].text
