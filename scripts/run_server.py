from __future__ import annotations

import sys
import types
import os
from pathlib import Path


ROOT_DIR = Path(os.environ.get("SGDI_RUNTIME_DIR", Path(__file__).resolve().parents[1]))
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _install_light_click() -> None:
    """Avoid importing click when Uvicorn is started programmatically."""

    if "click" not in sys.modules:
        def _decorator(*_: object, **__: object):
            return lambda func: func

        class _ClickShim(types.SimpleNamespace):
            def __getattr__(self, _: str):
                return lambda *args, **kwargs: object()

        sys.modules["click"] = _ClickShim(
            Choice=lambda *args, **kwargs: object(),
            Path=lambda *args, **kwargs: object(),
            File=lambda *args, **kwargs: object(),
            IntRange=lambda *args, **kwargs: object(),
            command=_decorator,
            argument=_decorator,
            option=_decorator,
            version_option=_decorator,
            echo=print,
            style=lambda text, **_: text,
        )


def main() -> None:
    _install_light_click()

    print("Chargement du serveur SGDI...", flush=True)

    from uvicorn.config import Config
    from uvicorn.server import Server

    print("Connexion a PostgreSQL et demarrage FastAPI...", flush=True)

    config = Config(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        http="h11",
        loop="asyncio",
        log_level="info",
        reload=False,
        ws="none",
    )
    try:
        Server(config).run()
    except KeyboardInterrupt:
        print("\nServeur SGDI arrete.", flush=True)


if __name__ == "__main__":
    main()
