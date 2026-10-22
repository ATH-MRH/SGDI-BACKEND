"""Pointeur V7 : modèle officiel à groupes fixes, adoption explicite du modèle.

Les modèles et événements historiques ne sont jamais réécrits. Les affectations actives et
les liens actifs des modèles officiels antérieurs sont datés et remplacés à la date de migration.
Aucun régime LEGACY/NORMAL ni modèle non officiel n'est converti. Cette migration n'est pas un déploiement.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa

revision = "20261025_0001"
down_revision = "20261024_0001"
branch_labels = None
depends_on = None

CODE = "3X8-FIXED-ABCD-V7"
OLD_CODE = "3X8-CONTINU-2222"


def upgrade():
    bind = op.get_bind()
    metadata = sa.MetaData()
    models = sa.Table('rotation_templates', metadata, autoload_with=bind)
    assignments = sa.Table('assignments', metadata, autoload_with=bind)
    links = sa.Table('site_rotations', metadata, autoload_with=bind)
    new_id = bind.scalar(sa.select(models.c.id).where(models.c.code == CODE))
    if new_id is None:
        bind.execute(models.insert().values(code=CODE, name='3x8 fixe — A matin / B après-midi / C nuit / D repos',
            description='Horaires permanents par groupe — politique Pointeur V7', cycle_length=4,
            cycle_days=[dict(status=status,shift=shift,label=shift,start_time=start,end_time=end) for status,shift,start,end in (
                ('matin','MATIN','06:00','14:00'),('apres_midi','APRES_MIDI','14:00','22:00'),
                ('nuit','NUIT','22:00','06:00'),('repos','OFF','',''))],
            group_offsets={'A':0,'B':1,'C':2,'D':3},active=1,official=1,version=7,created_at=datetime.utcnow()))
        new_id = bind.scalar(sa.select(models.c.id).where(models.c.code == CODE))
    old_ids = list(bind.scalars(sa.select(models.c.id).where(models.c.official == 1, models.c.id != new_id)))
    if old_ids:
        effective = datetime.now(ZoneInfo('Africa/Algiers')).date()
        for table, condition in ((assignments, assignments.c.work_regime == 'POSTE_CONTINU'), (links, sa.true())):
            rows = bind.execute(sa.select(table).where(table.c.rotation_id.in_(old_ids), table.c.active == 1,
                condition, sa.or_(table.c.end_date.is_(None), table.c.end_date >= effective))).mappings().all()
            for row in rows:
                if row['start_date'] >= effective:
                    bind.execute(table.update().where(table.c.id == row['id']).values(rotation_id=new_id))
                    continue
                # Clôture de l'intervalle historique, puis nouveau lien. Aucun historique n'est
                # recalculé avec le nouveau modèle et aucun événement n'est modifié.
                values = {key:value for key,value in row.items() if key != 'id'}
                values.update(rotation_id=new_id, start_date=effective, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
                if table.name == 'assignments':
                    values['change_reason'] = 'Adoption du planning fixe V7 (migration 20261025_0001). ' + (row.get('change_reason') or '')
                bind.execute(table.update().where(table.c.id == row['id']).values(end_date=effective-timedelta(days=1), active=0 if table.name == 'assignments' else 1))
                bind.execute(table.insert().values(**values))


def downgrade():
    # Aucune table/colonne à retirer. Les modèles restent lisibles pour les instantanés.
    # Refus d'un retour implicite lorsque le modèle est effectivement utilisé.
    bind = op.get_bind()
    used = bind.scalar(sa.text("SELECT COUNT(*) FROM assignments a JOIN rotation_templates r ON r.id=a.rotation_id WHERE r.code=:code"), {'code':CODE})
    linked = bind.scalar(sa.text("SELECT COUNT(*) FROM site_rotations s JOIN rotation_templates r ON r.id=s.rotation_id WHERE r.code=:code"), {'code':CODE})
    if used or linked:
        raise RuntimeError('Downgrade refusé : modèle V7 utilisé ; préparer un retour métier explicite sans supprimer les événements')
