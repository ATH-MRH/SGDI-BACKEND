"""Jeu de données FICTIF de l'environnement d'essai local : annonces, sociétés, un candidat et son parcours.
Il passe par les routes réelles du serveur, y compris l'identification par code (passerelle locale)."""
import datetime, json, os, re, sys, urllib.request, urllib.error
STATE = sys.argv[1]
BASE = 'http://127.0.0.1:8765/api'
def call(path, body=None, token=None, method=None, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method or ('POST' if body is not None else 'GET'),
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method or "?"} {path} -> {e.code} {e.read()[:300]}')
staff = call('/auth/login', {'username': os.environ['ADMIN_SYSTEM_USERNAME'], 'password': os.environ['ADMIN_SYSTEM_PASSWORD']})['access_token']
SEC, SOL, SER = 'IRON Global Sécurité', 'IRON Global Solution', 'IRON Global Services'
OFFERS = [
 (SEC, 'Agent de sécurité', 'Sécurité', 'Alger', None, 'CDI', 'Assurer la surveillance et la sécurité du site\nContrôler les accès et les flux de personnes\nPrévenir les risques et signaler les anomalies', 'Expérience souhaitée en sécurité\nBon sens du relationnel\nRigueur et réactivité\nDisponibilité pour travail en horaires décalés'),
 (SOL, 'Cariste', 'Logistique', 'Oran', None, 'CDD', 'Charger et décharger les marchandises\nRanger les palettes en entrepôt', 'Permis cariste valide\nRespect des règles de sécurité'),
 (SER, 'Agent de nettoyage', 'Nettoyage', 'Alger', None, 'CDI', 'Entretenir les locaux et les espaces communs', 'Ponctualité\nSens du travail soigné'),
 (SEC, 'Chef d’équipe sécurité', 'Sécurité', 'Oran', None, 'CDI', 'Encadrer une équipe d’agents\nOrganiser les plannings', 'Trois ans d’expérience en encadrement'),
]
ids = {}
for soc, title, prof, wilaya, loc, contract, missions, profile in reversed(OFFERS):
    o = call('/drh/job-offers', {'society': soc, 'title': title, 'profession': prof, 'wilaya': wilaya, 'location': loc, 'contract_type': contract, 'positions': 1, 'missions': missions, 'profile': profile}, staff)
    ids[title] = (o['id'], o['company_id'])
    call(f"/drh/job-offers/{o['id']}/publish", {}, staff)
call(f"/drh/job-offers/companies/{ids['Agent de sécurité'][1]}", {'name': SEC, 'sector': 'Sécurité des personnes et des biens', 'city': 'Alger',
     'description': 'Texte de test : la présentation de la société est saisie par le recrutement dans recrute.irongs.com et affichée telle quelle.',
     'activities': 'Gardiennage et surveillance\nSécurité incendie', 'locations': 'Alger, Oran', 'headcount': ''}, staff, 'PUT')
call(f"/drh/job-offers/companies/{ids['Cariste'][1]}", {'name': SOL, 'sector': 'Logistique', 'city': 'Oran'}, staff, 'PUT')

# Candidat fictif de la planche, identifié par le vrai parcours SMS (passerelle locale).
gw = {'X-SMS-Gateway-Key': os.environ['RECRUITMENT_SMS_GATEWAY_KEY']}
call('/public/mobile/gateway/poll', {}, headers=gw)
issued = call('/public/mobile/request-code', {'first_name': 'Amine', 'last_name': 'Bensalem', 'phone': '0770123456'})
job = call('/public/mobile/gateway/poll', {}, headers=gw)['job']
access = call('/public/mobile/verify-code', {'challenge_id': issued['challenge_id'], 'code': re.search(r'\b\d{6}\b', job['message'])[0]})['access_token']
opened = call('/public/emploi/session', {}, access)
cand = opened['session_token']
call('/public/emploi/me/profile', {'desired_position': 'Agent de sécurité', 'wilaya': 'Alger', 'commune': 'Hydra', 'address': 'Adresse de test', 'birth_date': '1994-03-12', 'sex': 'Masculin',
     'availability': 'Immédiate', 'languages': ['Arabe', 'Français'], 'skills': ['Surveillance de site', 'Contrôle d’accès', 'Premiers secours'],
     'experience': [{'position': 'Agent de sécurité', 'society': 'Société de test A', 'start_date': '2020-01-01', 'end_date': '2023-06-30'},
                    {'position': 'Agent d’accueil', 'society': 'Société de test B', 'start_date': '2018-02-01', 'end_date': '2019-12-31'}]}, cand, 'PUT')
pdf = open(os.path.join(STATE, 'cv-fictif.b64')).read()
call('/public/emploi/me/cv', {'name': 'Mon_CV.pdf', 'mime_type': 'application/pdf', 'data_base64': pdf}, cand, 'PUT')
apps = {}
for title in ('Agent de nettoyage', 'Cariste', 'Agent de sécurité'):
    apps[title] = call('/public/emploi/applications', {'offer_id': ids[title][0], 'request_id': 'seed-' + str(ids[title][0]).zfill(6), 'consent': True,
                       'message': 'Je suis très intéressé par ce poste et reste disponible pour un entretien.' if title == 'Agent de sécurité' else None}, cand)['application_id']
call('/public/emploi/alerts', {'profession': 'Sécurité', 'wilaya': 'Alger'}, cand)
extra = call('/drh/job-offers', {'society': SEC, 'title': 'Agent de sécurité incendie', 'profession': 'Sécurité', 'wilaya': 'Alger', 'contract_type': 'CDI', 'positions': 1,
             'missions': 'Assurer la prévention incendie du site', 'profile': 'Formation en sécurité incendie'}, staff)
call(f"/drh/job-offers/{extra['id']}/publish", {}, staff)          # correspond à l'alerte : notification d'offre
P = lambda app, **body: call(f'/drh/job-offers/applications/{app}/processing', body, staff, 'PUT')
P(apps['Cariste'], stage='review')
P(apps['Agent de sécurité'], stage='shortlisted')
M = lambda app, who, text, n: call(('/drh/job-offers' if who == 'r' else '/public/emploi') + f'/applications/{app}/messages', {'body': text, 'client_id': f'seed-msg-{n:04d}'}, staff if who == 'r' else cand)
sec = apps['Agent de sécurité']
M(sec, 'r', 'Bonjour Amine,\nNous avons bien reçu votre candidature pour le poste d’agent de sécurité. Seriez-vous disponible pour un entretien la semaine prochaine ?', 1)
M(sec, 'c', 'Bonjour,\nOui, je suis disponible. Quels sont les créneaux possibles ?', 2)
M(sec, 'r', 'Parfait ! Nous vous proposons un entretien dans nos locaux à Alger : la convocation vous parvient dans l’application. Cela vous convient-il ?', 3)
call(f'/drh/job-offers/applications/{sec}/interviews', {'starts_at': (datetime.datetime.now() + datetime.timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0).isoformat(), 'location': 'Alger — Siège IRON GLOBAL', 'contact': 'l’équipe recrutement'}, staff)
call('/drh/job-offers/tips', {'title': 'Préparer son entretien', 'summary': 'Nos conseils pour mettre toutes les chances de votre côté.', 'category': 'entretien', 'minutes': 4, 'status': 'published',
     'body': 'La veille\n- Relisez l’annonce : missions, lieu de travail, horaires\n- Préparez vos documents\nPendant l’entretien\n- Présentez votre parcours en deux minutes'}, staff)
call('/drh/job-offers/tips', {'title': 'Améliorer son CV', 'summary': 'Des astuces pour un CV clair et efficace.', 'category': 'cv', 'minutes': 3, 'status': 'published',
     'body': 'L’essentiel en haut\n- Nom, prénom, téléphone et wilaya\n- Le poste visé'}, staff)
# Repères du jeu d'essai pour les captures automatisées (fichier local, ignoré par Git).
json.dump({'ids': ids, 'apps': apps, 'session': {'token': cand, 'expiresAt': 4102444800000, 'identity': {'first_name': 'Amine', 'last_name': 'Bensalem', 'phone': '+213770123456'}}},
          open(os.path.join(STATE, 'seed.json'), 'w'), ensure_ascii=False)
print('Jeu d’essai créé : 5 annonces, 3 sociétés, candidat fictif Amine Bensalem (0770 12 34 56) avec 3 candidatures, des messages et un entretien.')
