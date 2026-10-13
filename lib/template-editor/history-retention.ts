import type {DocumentHistoryEntry} from './persistence';
/** Spend the budget on newest checkpoints globally. Purged documents retain
 * a bounded recovery window instead of starving current documents forever. */
export function retainDocumentHistory(history:Record<string,DocumentHistoryEntry[]>,activeIds:Set<string>,now=Date.now(),budget=20*1024*1024):Record<string,DocumentHistoryEntry[]>{
 const entries=Object.entries(history).flatMap(([documentId,values])=>values.toSorted((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,30).filter(entry=>activeIds.has(documentId)||now-Date.parse(entry.createdAt)<=7*86400000).map(entry=>({documentId,entry})));
 entries.sort((a,b)=>Date.parse(b.entry.createdAt)-Date.parse(a.entry.createdAt));
 const result:Record<string,DocumentHistoryEntry[]>={};let used=0;
 for(const {documentId,entry} of entries){const size=new TextEncoder().encode(JSON.stringify(entry.document)).byteLength;if(size>budget-used)continue;used+=size;(result[documentId]??=[]).push(entry);}
 return result;
}
