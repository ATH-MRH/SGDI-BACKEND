from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base

from app.modules.auth import models as _auth_models  # noqa: F401
from app.modules.drh import models as _drh_models  # noqa: F401
from app.modules.irongs import models as _irongs_models  # noqa: F401
from app.modules import finance_models as _finance_models  # noqa: F401
from app.modules.materiel import models as _materiel_models  # noqa: F401
from app.modules.ops import models as _ops_models  # noqa: F401
from app.modules.accounting import models as _accounting_models  # noqa: F401
from app.modules.achats import models as _achats_models  # noqa: F401
from app.modules.ventes import models as _ventes_models  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
