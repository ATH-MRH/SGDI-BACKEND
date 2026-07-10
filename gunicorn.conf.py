import os

# preload_app : l'app est chargée UNE fois dans le master puis forkée -> mémoire partagée
# (copy-on-write). Chaque worker consomme donc beaucoup moins de RAM, ce qui permet d'en
# mettre plus SANS saturer le serveur (le vrai levier de vitesse, plutôt que d'empiler des
# workers qui rechargent chacun toute l'app). Réglez WEB_CONCURRENCY selon la RAM du serveur
# (VPS limité : 2-3 ; serveur bureau dédié bien doté : 4-8+).
workers = int(os.environ.get("WEB_CONCURRENCY", 3))
worker_class = "uvicorn.workers.UvicornWorker"
bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
proxy_headers = True
forwarded_allow_ips = "*"
timeout = 120
keepalive = 5
preload_app = True


def post_fork(server, worker):
    # Chaque worker reçoit un identifiant unique.
    # Le scheduler email n'est activé que dans le worker 1.
    os.environ["GUNICORN_WORKER_ID"] = str(worker.age)
    # IMPORTANT avec preload_app : le pool de connexions DB créé dans le master ne doit
    # JAMAIS être partagé entre process forkés. On le jette pour que chaque worker ouvre
    # ses propres connexions.
    try:
        from app.db.session import engine
        engine.dispose()
    except Exception:
        pass
