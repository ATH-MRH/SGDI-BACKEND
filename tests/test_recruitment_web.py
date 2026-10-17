from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.modules import recruitment_web as web


def public_client():
    app = FastAPI()
    app.include_router(web.router)
    return TestClient(app)


def test_host_and_landing_are_separate_from_staff():
    assert web.is_employment_host('emploi.irongs.com:443')
    assert web.is_employment_host('www.emploi.irongs.com')
    assert not web.is_employment_host('recrute.irongs.com')
    assert not web.is_employment_host('emploi.irongs.com.attacker.test')
    response = public_client().get('/emploi')
    assert response.status_code == 200
    assert 'Consulter les offres et postuler' in response.text
    assert 'offer-search' in response.text and '/espace/identify' in response.text


def test_spa_routes_refresh_and_missing_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(web, 'WEB', tmp_path)
    client = public_client()
    assert client.get('/espace/offers/23').status_code == 503
    (tmp_path / 'index.html').write_text('<html>Candidate web</html>')
    assert client.get('/espace/offers/23').text == '<html>Candidate web</html>'
    assert client.get('/espace/missing.js').status_code == 404
    assert client.get('/espace/assets/missing').status_code == 404
    assert client.get('/espace/%2e%2e/secret').status_code == 404
    assert client.get('/espace/').headers['cache-control'] == 'no-store'


def test_android_download_only_configured_https_or_local_apk(tmp_path, monkeypatch):
    monkeypatch.delenv('RECRUITMENT_ANDROID_APK_PATH', raising=False)
    monkeypatch.delenv('RECRUITMENT_ANDROID_APK_URL', raising=False)
    client = public_client()
    assert client.get('/emploi/telecharger').status_code == 503
    assert client.get('/emploi/config').json() == {'android_available': False}
    monkeypatch.setenv('RECRUITMENT_ANDROID_APK_URL', 'http://example.test/app.apk')
    assert client.get('/emploi/telecharger').status_code == 503
    monkeypatch.setenv('RECRUITMENT_ANDROID_APK_URL', 'https://example.test/app.apk')
    response = client.get('/emploi/telecharger', follow_redirects=False)
    assert response.status_code == 307 and response.headers['location'] == 'https://example.test/app.apk'
    apk = tmp_path / 'iron.apk'
    apk.write_bytes(b'APK fixture')
    monkeypatch.setenv('RECRUITMENT_ANDROID_APK_PATH', str(apk))
    response = client.get('/emploi/telecharger')
    assert response.content == b'APK fixture'
    assert client.get('/emploi/config').json() == {'android_available': True}
    assert 'attachment' in response.headers['content-disposition']


def test_qr_is_local_and_contains_no_candidate_data():
    response = public_client().get('/emploi/qr.svg')
    assert response.status_code == 200 and '<svg' in response.text
    assert response.headers['content-type'].startswith('image/svg+xml')


def test_actual_application_hosts_keep_staff_and_legacy_separate(client):
    landing = client.get('/', headers={'host': 'emploi.irongs.com'})
    assert landing.status_code == 200 and 'offer-search' in landing.text
    staff = client.get('/', headers={'host': 'recrute.irongs.com'})
    assert staff.status_code == 200 and 'loginBtn' in staff.text
    legacy = client.get('/', headers={'host': 'fr.irongs.com'})
    assert legacy.status_code == 200 and 'Fiche candidat' in legacy.text
