/** Gmail puts SENT on self-addressed mail too; never treat it as a prospect reply. */
export function isInboundCandidate(labelIds:string[]|null|undefined):boolean{
  const labels=new Set(labelIds??[])
  return labels.has('INBOX')&&!labels.has('SENT')&&!labels.has('DRAFT')
}
