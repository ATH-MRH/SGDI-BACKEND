"""Pointeur V7 : modèle officiel à groupes fixes, adoption explicite du modèle.

Les modèles et événements historiques ne sont jamais réécrits. Les affectations actives et
les liens actifs des modèles officiels antérieurs sont datés et remplacés à la date explicite
validée par le précontrôle, sans enchaînement nocturne dangereux.
Aucun régime LEGACY/NORMAL ni modèle non officiel n'est converti. Cette migration n'est pas un déploiement.
"""
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa

revision = "20261025_0001"
down_revision = "20261024_0001"
branch_labels = None
depends_on = None

CODE = "3X8-FIXED-ABCD-V7"
OLD_CODE = "3X8-CONTINU-2222"


def _adoption_date(bind, models, assignments, links, *, proposed_date=None, require_today=True):
    """Fail closed before writing: an explicit, safe cutover is required for populated sites.

    Eight hours is a conservative technical transition guard, not a legal rest rule.
    Historical shifts remain immutable, including a night spanning the civil cutover.
    """
    today = datetime.now(ZoneInfo('Africa/Algiers')).date()
    target = proposed_date or today
    old_models = {row['id']:row for row in bind.execute(sa.select(models).where(
        models.c.official == 1, models.c.code != CODE)).mappings()}
    posted = bind.execute(sa.select(assignments).where(
        assignments.c.rotation_id.in_(old_models), assignments.c.active == 1,
        assignments.c.work_regime == 'POSTE_CONTINU',
        sa.or_(assignments.c.end_date.is_(None), assignments.c.end_date >= target))).mappings().all()
    old_links = bind.execute(sa.select(links).where(links.c.rotation_id.in_(old_models), links.c.active == 1,
        sa.or_(links.c.end_date.is_(None), links.c.end_date >= target))).mappings().all()
    if not posted and not old_links:
        return target
    raw = proposed_date.isoformat() if proposed_date else os.environ.get('ATLAS_V7_EFFECTIVE_DATE', '')
    try:
        effective = date.fromisoformat(raw)
    except ValueError:
        raise RuntimeError('Transition V7 refusée : ATLAS_V7_EFFECTIVE_DATE explicite requise (YYYY-MM-DD)') from None
    if require_today and effective != today:
        raise RuntimeError('Transition V7 refusée : la date doit être le jour local du basculement ; aucune adoption rétroactive ou future implicite')
    previous_day = effective - timedelta(days=1)
    starts = {'A':6, 'B':14, 'C':22}
    problems = []
    for row in posted:
        model = old_models[row['rotation_id']]
        anchors = [link for link in old_links if link['site_id']==row['site_id']
                   and link['rotation_id']==row['rotation_id'] and link['start_date']<=previous_day
                   and (link['end_date'] is None or link['end_date']>=previous_day)]
        if row['start_date'] >= effective:
            continue  # No previous shift under this dated assignment.
        if not anchors:
            problems.append(f"site={row['site_id']} employe={row['employee_id']} ancrage historique absent")
            continue
        anchor = max(anchors, key=lambda a:(a['start_date'],a['id']))
        days, offsets = model['cycle_days'], model['group_offsets']
        try:
            slot = days[((previous_day-anchor['start_date']).days+int(offsets[row['group_code']]))%len(days)]
            if row['group_code'] in starts and slot['shift'] != 'OFF':
                begin = datetime.combine(previous_day, datetime.strptime(slot['start_time'],'%H:%M').time(),ZoneInfo('Africa/Algiers'))
                end = datetime.combine(previous_day, datetime.strptime(slot['end_time'],'%H:%M').time(),ZoneInfo('Africa/Algiers'))
                if end <= begin: end += timedelta(days=1)
                next_start = datetime.combine(effective,datetime.min.time(),ZoneInfo('Africa/Algiers'))+timedelta(hours=starts[row['group_code']])
                if next_start-end < timedelta(hours=8):
                    problems.append(f"site={row['site_id']} employe={row['employee_id']} repos de transition inférieur à 8h ({end.isoformat()} -> {next_start.isoformat()})")
        except (KeyError,TypeError,ValueError,ZeroDivisionError):
            problems.append(f"site={row['site_id']} employe={row['employee_id']} planning historique invalide")
    # Do not reinterpret a shift already started on the adoption work date.
    if posted and sa.inspect(bind).has_table('attendance_events'):
        events = sa.Table('attendance_events',sa.MetaData(),autoload_with=bind)
        ids = {row['employee_id'] for row in posted}
        latest = {}
        for event in bind.execute(sa.select(events).where(events.c.employee_id.in_(ids),
                events.c.event_type.in_(['ARRIVAL','DEPARTURE'])).order_by(events.c.occurred_at.desc(),events.c.id.desc())).mappings():
            latest.setdefault(event['employee_id'],event)
        for row in posted:
            event = latest.get(row['employee_id'])
            if event is None: continue
            if event['presence_date'] >= effective:
                problems.append(f"site={row['site_id']} employe={row['employee_id']} pointage déjà enregistré au jour du basculement")
            elif event['event_type']=='ARRIVAL' and row['group_code'] in starts:
                frozen = (event['data'] or {}).get('counted') or {}
                try:
                    end = datetime.fromisoformat(frozen['scheduled_end'])
                    next_start = datetime.combine(effective,datetime.min.time(),ZoneInfo('Africa/Algiers'))+timedelta(hours=starts[row['group_code']])
                    if next_start-max(end,datetime.now(ZoneInfo('Africa/Algiers'))) < timedelta(hours=8):
                        problems.append(f"site={row['site_id']} employe={row['employee_id']} vacation ouverte incompatible")
                except (KeyError,TypeError,ValueError):
                    problems.append(f"site={row['site_id']} employe={row['employee_id']} vacation ouverte sans fin vérifiable")
    if problems:
        raise RuntimeError('Transition V7 refusée avant écriture : ' + '; '.join(problems))
    return effective


def upgrade():
    bind = op.get_bind()
    metadata = sa.MetaData()
    models = sa.Table('rotation_templates', metadata, autoload_with=bind)
    assignments = sa.Table('assignments', metadata, autoload_with=bind)
    links = sa.Table('site_rotations', metadata, autoload_with=bind)
    effective = _adoption_date(bind, models, assignments, links)
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
    events = sa.Table('attendance_events',sa.MetaData(),autoload_with=bind)
    facts = bind.scalar(sa.select(sa.func.count()).select_from(events).where(sa.or_(
        events.c.data['counted']['policy_version'].as_integer()==7,
        events.c.data['counted']['model_version'].as_integer()==7,
        events.c.data['policy_version'].as_integer()==7,
        events.c.data['code'].as_string()=='OFF_SCHEDULE_REFUSED')))
    if used or linked or facts:
        raise RuntimeError('Downgrade refusé : modèle V7 utilisé ; préparer un retour métier explicite sans supprimer les événements')

    # An unused catalog entry has no history to preserve. Remove only that entry,
    # so a complete rollback to the parent is lossless; used snapshots refuse above.
    bind.execute(sa.text("DELETE FROM rotation_templates WHERE code=:code"), {'code':CODE})
