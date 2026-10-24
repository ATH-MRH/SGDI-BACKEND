"""Pure, deterministic occurrences. No database, current clock or monthly reset."""
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ENGINE_VERSION = 'atlas-rotations-2'
REGIMES = ('3X8', '24H48', '1/2', '1/3', 'NORMAL', 'CUSTOM')
GROUPS = tuple('ABCD')


def minutes(value):
    parsed = time.fromisoformat(value)
    if parsed.second or parsed.microsecond or parsed.tzinfo:
        raise ValueError('Les horaires doivent être locaux et précis à la minute')
    return parsed.hour * 60 + parsed.minute


SHIFT_NAMES_3X8 = ('Matin', 'Après-midi', 'Nuit')


def _hm_label(value):
    return f"{value//60:02d}:{value%60:02d}"


def check_3x8_shifts(slots):
    """Contrôle des trois vacations 3×8 (Matin → Après-midi → Nuit) avec un message explicite pour
    OPS : chacune dure 8 h, la suivante commence à la fin de la précédente (aucun trou, aucun
    chevauchement), la nuit peut traverser minuit. Les horaires eux-mêmes sont libres."""
    if not isinstance(slots, list) or len(slots) != 3 or any(not isinstance(s, dict) or not s.get('start') or not s.get('end') for s in slots):
        raise ValueError('Horaires des trois vacations requis : Matin, Après-midi et Nuit (début et fin)')
    starts = [minutes(s['start']) for s in slots]; ends = [minutes(s['end']) for s in slots]
    for name, a, b in zip(SHIFT_NAMES_3X8, starts, ends):
        length = (b - a) % 1440
        if length == 0:
            raise ValueError(f'La vacation {name} est vide : son début et sa fin sont identiques ({_hm_label(a)})')
        if length != 480:
            raise ValueError(f'La vacation {name} ({_hm_label(a)} → {_hm_label(b)}) dure {length//60} h {length%60:02d} : une vacation 3×8 dure 8 h')
    for i in range(3):
        nxt = (i + 1) % 3; gap = (starts[nxt] - ends[i]) % 1440
        if gap:
            if gap < 720:
                raise ValueError(f'Trou de {gap} min entre la fin de la vacation {SHIFT_NAMES_3X8[i]} ({_hm_label(ends[i])}) '
                                 f'et le début de la vacation {SHIFT_NAMES_3X8[nxt]} ({_hm_label(starts[nxt])})')
            raise ValueError(f'Chevauchement de {1440-gap} min entre la vacation {SHIFT_NAMES_3X8[i]} (fin {_hm_label(ends[i])}) '
                             f'et la vacation {SHIFT_NAMES_3X8[nxt]} (début {_hm_label(starts[nxt])})')


def complete_3x8(config):
    """Planning intelligent 3×8 : OPS saisit la date de début du cycle et les six horaires ; ATLAS
    calcule le reste et l'écrit dans la configuration, donc dans la version datée et son historique
    (liste `derived`). Principe : 4 groupes, 3 vacations, 1 groupe OFF ; chaque groupe enchaîne
    Matin → Après-midi → Nuit → OFF, une position par jour, et le groupe OFF change chaque jour
    (A/B/C/D en positions 0/1/2/3 à la date de début). Exploitation continue 7 j/7, jours fériés
    compris. Une valeur fournie explicitement n'est jamais remplacée."""
    c = deepcopy(config)
    if c.get('regime') != '3X8':
        return c
    check_3x8_shifts(c.get('shifts'))
    anchor = date.fromisoformat(c['anchor']) if c.get('anchor') else None
    if anchor is None:
        raise ValueError('Date de début du cycle requise')
    night = c['shifts'][2]
    defaults = {
        'phases': {'A': 0, 'B': 1, 'C': 2, 'D': 3}, 'days_per_position': 1,
        'week_start': 0, 'workdays': list(range(7)), 'weekend': [], 'holidays': [],
        'night_start': night['start'], 'night_end': night['end'],
        'minimum_rest_minutes': 480, 'early_minutes': 45, 'late_refusal_minutes': 30,
        'required_staff': {'MATIN': 1, 'APRES_MIDI': 1, 'NUIT': 1},
        'calendar_source': 'Planning intelligent ATLAS — 3×8 continu (7 j/7, jours fériés compris)', 'calendar_version': '1',
        'calendar_valid_from': anchor.isoformat(), 'calendar_valid_until': date(anchor.year + 10, anchor.month, min(anchor.day, 28)).isoformat(),
    }
    derived = [k for k in defaults if k not in c or c[k] in (None, '')]
    for k in derived:
        c[k] = deepcopy(defaults[k])
    if derived:
        c['derived'] = sorted(set(c.get('derived') or []) | set(derived))
    return c


def validate(config):
    c = complete_3x8(config)
    required = ('regime','timezone','anchor','phases','minimum_rest_minutes','early_minutes',
                'late_refusal_minutes','workdays','weekend','holidays','night_start','night_end',
                'required_staff','calendar_source','calendar_version','calendar_valid_from','calendar_valid_until')
    if any(k not in c for k in required):
        raise ValueError('Configuration explicite et complète requise')
    # Calendrier propre au site (ex. dimanche → jeudi ouvrés) : jamais de lundi–vendredi implicite.
    if type(c.get('week_start')) is not int or c['week_start'] not in range(7):
        raise ValueError('Début de semaine requis (0 = lundi … 6 = dimanche)')
    if c['regime'] not in REGIMES:
        raise ValueError('Régime inconnu')
    ZoneInfo(c['timezone']); date.fromisoformat(c['anchor'])
    for k in ('minimum_rest_minutes','early_minutes','late_refusal_minutes'):
        if type(c[k]) is not int or c[k] < 0 or c[k] > 10080:
            raise ValueError('Paramètre minute invalide : '+k)
    if c['late_refusal_minutes'] == 0:
        raise ValueError('Seuil de retard strictement positif requis')
    if any(type(n) is not int or n not in range(7) for k in ('workdays','weekend') for n in c[k]):
        raise ValueError('Jour de semaine invalide')
    if set(c['workdays']) & set(c['weekend']) or set(c['workdays']) | set(c['weekend']) != set(range(7)):
        raise ValueError('Jours ouvrés et week-end doivent partitionner la semaine')
    if c['regime']=='1/3' and not c['workdays']:
        raise ValueError('Jours ouvrés du groupe A requis')
    for d in c['holidays']: date.fromisoformat(d)
    if date.fromisoformat(c['calendar_valid_until']) < date.fromisoformat(c['calendar_valid_from']):
        raise ValueError('Période du calendrier invalide')
    for k in ('night_start','night_end'): minutes(c[k])
    if c['night_start'] == c['night_end']: raise ValueError('Plage de nuit vide')
    phases=c['phases']; regime=c['regime']
    if not str(c['calendar_source']).strip() or not str(c['calendar_version']).strip():
        raise ValueError('Référence et version du calendrier requises')
    staff_keys=('MATIN','APRES_MIDI','NUIT') if regime=='3X8' else ('JOUR','NUIT')
    if not isinstance(c['required_staff'],dict) or any(type(c['required_staff'].get(k)) is not int or c['required_staff'][k]<1 for k in staff_keys):
        raise ValueError('Effectif requis positif pour chaque vacation obligatoire')
    if set(phases) != set(GROUPS) or any(type(v) is not int for v in phases.values()):
        raise ValueError('Phases explicites A/B/C/D requises')
    if regime == '3X8':
        if type(c.get('days_per_position')) is not int or c['days_per_position'] not in range(1,32):
            raise ValueError('Durée des positions 3×8 requise')
        check_3x8_shifts(c.get('shifts'))
        n=c['days_per_position']
        if any(sorted(((day+v)%(4*n))//n for v in phases.values())!=[0,1,2,3] for day in range(4*n)):
            raise ValueError('Phases 3×8 sans couverture continue')
    elif regime in ('24H48','1/3'):
        for k in ('day_start','day_end','night_shift_start','night_shift_end'): minutes(c[k])
        if c['day_end']!=c['night_shift_start'] or c['night_shift_end']!=c['day_start']:
            raise ValueError('Jour et Nuit doivent couvrir 24h sans trou')
        if not 0 < (minutes(c['day_end'])-minutes(c['day_start']))%1440 < 1440:
            raise ValueError('Vacation Jour invalide')
        if minutes(c['day_start'])>=minutes(c['day_end']):
            raise ValueError('La vacation Jour doit rester dans la journée')
        if regime=='1/3' and night_minutes(*interval(date.fromisoformat(c['anchor']),c['day_start'],c['day_end'],c['timezone']),c):
            raise ValueError('Le groupe A ne doit comporter aucune minute de travail de nuit')
        offsets=list(phases.values()) if regime=='24H48' else [phases[g] for g in 'BCD']
        size=4 if regime=='24H48' else 3
        if sorted(v%size for v in offsets)!=list(range(size)):
            raise ValueError('Phases sans couverture nocturne unique')
    elif regime=='1/2':
        minutes(c['first_start'])
        if sorted(v%4 for v in phases.values())!=list(range(4)):
            raise ValueError('Ordre A/B/C/D invalide')
    else:
        # Extension points are explicit; do not silently turn an unsupported regime into 3×8.
        raise ValueError('Régime extensible non encore publiable : '+regime)
    return c


def interval(day,start,end,tz):
    begin=datetime.combine(day,time.fromisoformat(start),ZoneInfo(tz))
    finish=datetime.combine(day,time.fromisoformat(end),ZoneInfo(tz))
    if finish<=begin: finish+=timedelta(days=1)
    return begin,finish


def night_minutes(start,end,c):
    total=0
    d=start.date()-timedelta(days=1)
    while d<=end.date():
        a,b=interval(d,c['night_start'],c['night_end'],c['timezone'])
        total+=max(0,int((min(end,b)-max(start,a)).total_seconds()//60))
        d+=timedelta(days=1)
    return total


def week_of(day,c):
    """Premier jour de la semaine du site contenant ce jour de travail."""
    return day-timedelta(days=(day.weekday()-c['week_start'])%7)


def _slot(day,kind,group,start,end,c):
    a,b=interval(day,start,end,c['timezone'])
    return {'work_date':day.isoformat(),'shift':kind,'group':group,
            'start':a.isoformat(),'end':b.isoformat(),'required':True,
            'night_minutes':night_minutes(a,b,c),'replacement':False}


def compatible(slot,others,rest):
    a,b=datetime.fromisoformat(slot['start']),datetime.fromisoformat(slot['end'])
    margin=timedelta(minutes=rest)
    return all(b+margin<=datetime.fromisoformat(s['start']) or
               datetime.fromisoformat(s['end'])+margin<=a for s in others)


def occurrences(config,first,days):
    c=validate(config)
    if not 1<=days<=366: raise ValueError('Horizon de 1 à 366 jours requis')
    first=date.fromisoformat(first) if isinstance(first,str) else first
    anchor=date.fromisoformat(c['anchor']); regime=c['regime']; phases=c['phases']
    # Stable look-around covers the full rest horizon. Boundary choices never depend
    # on the requested month. 1/3 eligibility uses the immutable nightly backbone.
    padding=9
    start=first-timedelta(days=padding); stop=first+timedelta(days=days+padding)
    result=[]; backbone=[]
    d=start
    while d<stop:
        delta=(d-anchor).days
        if regime=='3X8':
            for g in GROUPS:
                index=((delta+phases[g])%(4*c['days_per_position']))//c['days_per_position']
                if index<3:
                    s=c['shifts'][index];result.append(_slot(d,('MATIN','APRES_MIDI','NUIT')[index],g,s['start'],s['end'],c))
        elif regime=='24H48':
            for g in GROUPS:
                position=(delta+phases[g])%4
                if position in (0,1):
                    result.append(_slot(d,'JOUR' if position==0 else 'NUIT',g,
                        c['day_start'] if position==0 else c['night_shift_start'],
                        c['day_end'] if position==0 else c['night_shift_end'],c))
        elif regime=='1/2':
            for position in range(2):
                index=2*delta+position
                g=next(g for g in GROUPS if phases[g]%4==index%4)
                a=datetime.combine(d,time.fromisoformat(c['first_start']),ZoneInfo(c['timezone']))+timedelta(hours=12*position)
                b=a+timedelta(hours=12)
                result.append({'work_date':a.date().isoformat(),'shift':'JOUR' if position==0 else 'NUIT',
                    'group':g,'start':a.isoformat(),'end':b.isoformat(),'required':True,
                    'night_minutes':night_minutes(a,b,c),'replacement':False})
        else:
            g=next(g for g in 'BCD' if (delta+phases[g])%3==0)
            backbone.append(_slot(d,'NUIT',g,c['night_shift_start'],c['night_shift_end'],c))
        d+=timedelta(days=1)
    if regime=='1/3':
        result=list(backbone); d=start
        order=sorted('BCD',key=lambda g:(-phases[g])%3)
        while d<stop:
            working=d.weekday() in c['workdays'] and d.isoformat() not in c['holidays']
            slot=_slot(d,'JOUR','A' if working else None,c['day_start'],c['day_end'],c)
            if not working:
                delta=(d-anchor).days
                # Next nocturnal groups in phase order; the same day is excluded by
                # its next shift/rest and the previous night by its actual end.
                candidates=sorted(order,key=lambda g: (-(delta+phases[g]))%3)
                slot['excluded']={}
                for g in candidates:
                    others=[s for s in backbone if s['group']==g]
                    # Never join a day to either neighbouring night, including
                    # when OPS explicitly configures zero minimum rest. The sole
                    # remaining group recurs every three days, so replacements
                    # cannot depend on the beginning of the requested horizon.
                    if compatible(slot,others,max(1,c['minimum_rest_minutes'])):
                        slot['group']=g;slot['replacement']=True;break
                    slot['excluded'][g]='Conflit ou repos insuffisant'
            result.append(slot);d+=timedelta(days=1)
    selected=[s for s in result if first<=date.fromisoformat(s['work_date'])<first+timedelta(days=days)]
    for s in selected:
        s['week']=week_of(date.fromisoformat(s['work_date']),c).isoformat()
    selected.sort(key=lambda s:(s['start'],s['shift'],s['group'] or ''))
    errors=[]
    for day in sorted({s['work_date'] for s in selected}):
        if not c['calendar_valid_from'] <= day <= c['calendar_valid_until']:
            errors.append({'code':'CALENDAR_UNCONFIRMED','label':'Calendrier non confirmé','date':day})
    for s in selected:
        if s['group'] is None:
            errors.append({'code':'UNCOVERED_SHIFT','label':'VACATION NON COUVERTE','slot':s})
        elif not compatible(s,[o for o in result if o is not s and o['group']==s['group']],c['minimum_rest_minutes']):
            errors.append({'code':'REST_OR_OVERLAP','label':'Chevauchement ou repos insuffisant','slot':s})
    return {'engine_version':ENGINE_VERSION,'slots':selected,'errors':errors,'valid':not errors}
