#!/usr/bin/env python3
"""Archive and summarize five interleaved browser runs of each product state."""
import argparse,gzip,hashlib,itertools,json,statistics
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    reference=None;result={'states':{},'order':['base,c3,c1,c2','c3,c2,base,c1','c1,base,c2,c3','c2,c1,c3,base','base,c2,c3,c1']}
    metrics=['firstReadyMs','settledMs','fetchCount','apiBytes','domWriteMs','domWrites','jsonParseMs','moduleStartMs','moduleDownloadMs','moduleInitMs','scriptEvalMs','imageRequests','documentRequests']
    cold={}
    for state in ['base','c1','c2','c3']:
        reports=[]
        for i in range(1,6):
            source=args.input/f'{state}-run-{i}.json';raw=source.read_bytes();x=json.loads(raw)
            assert not x.get('failure') and not x['errors'],source
            assert all(200<=r['status']<300 for r in x['requests']),source
            meta={k:x[k] for k in ['runtime','schemaVersion','observerVersion','observerSha256','backendCachePolicy','methodology']}
            if reference is None:reference=meta
            assert meta==reference,source
            for p in x['phases']:
                assert p['state']=={'employeeCount':1000,'candidateCount':500,'hydrated':True,'fullDataReady':True},source
            assert x['phases'][1]['visibleRows']==572 and x['phases'][1]['visibleElements']==9797,source
            (args.out/(source.name+'.gz')).write_bytes(gzip.compress(raw,mtime=0))
            reports.append(x)
        provenance=json.loads((args.input/state/'measurement-provenance.json').read_text())
        phases={}
        for phase in ['cold','employees','warm']:
            rows=[next(p for p in x['phases'] if p['name']==phase) for x in reports];phases[phase]={}
            for key in metrics:
                values=[p[key] for p in rows if p.get(key) is not None]
                if values:phases[phase][key]={'p50':statistics.median(values),'min':min(values),'max':max(values),'samples':values}
        cold[state]=phases['cold']['firstReadyMs']['samples']
        result['states'][state]={'provenance':provenance,'runs':5,'phases':phases}
    differences=[c-b for b,c in zip(cold['base'],cold['c3'])]
    average=statistics.mean(differences)
    permutations=[statistics.mean(s*d for s,d in zip(signs,differences)) for signs in itertools.product([-1,1],repeat=5)]
    result['paired_cold']={'differences_ms':differences,'mean_ms':average,'one_sided_sign_flip_p_slower':sum(v>=average-1e-9 for v in permutations)/len(permutations),'caution':'Exploratory paired sign-flip test, only five rounds; non-significance does not prove equivalence or production performance.'}
    result['metadata']=reference
    result['validation']='20 successful runs; identical metadata and expected populations; no discarded completed run'
    (args.out/'summary.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({s:{p:result['states'][s]['phases'][p]['firstReadyMs']['p50'] for p in ['cold','employees','warm']} for s in cold}))
if __name__=='__main__':main()
