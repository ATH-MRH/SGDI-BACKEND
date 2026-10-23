"""Précontrôle V7 en lecture seule ; aucune migration, adoption ou modification."""
import argparse
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
import sys

import sqlalchemy as sa


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--effective-date',type=date.fromisoformat,required=True)
    args=parser.parse_args()
    url=os.environ.get('DATABASE_URL')
    if not url:
        parser.error('DATABASE_URL explicite requis ; aucun chargement implicite de .env')
    path=Path(__file__).resolve().parents[1]/'migrations/versions/20261025_0001_pointeur_fixed_groups.py'
    spec=importlib.util.spec_from_file_location('v7_preflight',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    engine=sa.create_engine(url)
    try:
        with engine.connect() as conn:
            if engine.dialect.name=='postgresql':conn.exec_driver_sql('SET TRANSACTION READ ONLY')
            elif engine.dialect.name=='sqlite':conn.exec_driver_sql('PRAGMA query_only=ON')
            else:raise RuntimeError('Précontrôle limité à PostgreSQL et SQLite')
            metadata=sa.MetaData()
            tables=[sa.Table(name,metadata,autoload_with=conn) for name in ('rotation_templates','assignments','site_rotations')]
            migration._adoption_date(conn,*tables,proposed_date=args.effective_date,require_today=False)
        result={'status':'READY','effective_date':args.effective_date.isoformat(),
                'read_only':True,'minimum_transition_rest_hours':8,
                'notice':'Précontrôle technique ; exige une validation de relève et un GO DG distinct.'}
        code=0
    except (RuntimeError,sa.exc.SQLAlchemyError) as exc:
        # Do not print credentials, SQL parameters or connection diagnostics.
        message=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
        result={'status':'BLOCKED','effective_date':args.effective_date.isoformat(),'read_only':True,'reason':message}
        code=1
    finally:engine.dispose()
    print(json.dumps(result,ensure_ascii=False))
    return code


if __name__=='__main__':sys.exit(main())
