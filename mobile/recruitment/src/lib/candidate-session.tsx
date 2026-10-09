import { createContext, useContext, useState, ReactNode } from 'react';
export type CandidateIdentity={first_name:string;last_name:string;phone:string};
export type PendingCode={identity:CandidateIdentity;challengeId:string;expiresAt:number;resendAt:number};
export type CandidateAccess={identity:CandidateIdentity;token:string;expiresAt:number};
type State={pending:PendingCode|null;access:CandidateAccess|null;setPending:(v:PendingCode|null)=>void;setAccess:(v:CandidateAccess|null)=>void};
const Context=createContext<State|null>(null);
export function CandidateSessionProvider({children}:{children:ReactNode}) {
 const [pending,setPending]=useState<PendingCode|null>(null),[access,setAccess]=useState<CandidateAccess|null>(null);
 return <Context.Provider value={{pending,access,setPending,setAccess}}>{children}</Context.Provider>;
}
export function useCandidateSession(){const value=useContext(Context);if(!value)throw new Error('CandidateSessionProvider absent');return value;}
