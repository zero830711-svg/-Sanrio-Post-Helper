"""Update only the existing, publicly verified sitemap using explicit FTPS."""
import ftplib
import hashlib
import io
import json
import os
import ssl
from pathlib import Path
from urllib import request, parse

NAME='catalog-image-sitemap.xml'
URL='https://sanrio-fan.site/'+NAME

def main():
 data=Path(NAME).read_bytes()
 with request.urlopen(URL,timeout=60) as r:old=r.read()
 host=os.environ['LOLIPOP_FTP_HOST'];parts=parse.urlsplit(host if '://' in host else 'ftp://'+host)
 with ftplib.FTP_TLS(timeout=30,context=ssl.create_default_context()) as ftp:
  ftp.connect(parts.hostname,parts.port or 21)
  ftp.login(os.environ['LOLIPOP_FTP_USER'],os.environ['LOLIPOP_FTP_PASSWORD']);ftp.prot_p()
  base=ftp.pwd();queue=[(base,0)];found=None;seen=set()
  while queue and len(seen)<250:
   folder,depth=queue.pop(0)
   if folder in seen:continue
   seen.add(folder)
   try:
    ftp.cwd(folder)
    try:entries=list(ftp.mlsd())
    except ftplib.error_perm:
     entries=[]
     for name in ftp.nlst():
      name=name.rstrip('/').split('/')[-1]
      if name in ('.','..'):continue
      try:ftp.cwd(folder.rstrip('/')+'/'+name);kind='dir';ftp.cwd(folder)
      except ftplib.error_perm:kind='file'
      entries.append((name,{'type':kind}))
   except ftplib.error_perm:continue
   for name,facts in entries:
    if name==NAME and facts.get('type')=='file':
     content=io.BytesIO();ftp.retrbinary('RETR '+NAME,content.write)
     if content.getvalue()==old:found=folder;break
   if found:break
   if depth<4:
    dirs=[name for name,f in entries if f.get('type')=='dir' and not name.startswith('.') and name not in ('wp-admin','wp-includes','wp-content','logs','log')]
    dirs.sort(key=lambda n:(not any(x in n.lower() for x in ('sanrio','fan','public','www')),n))
    queue.extend((folder.rstrip('/')+'/'+name,depth+1) for name in dirs)
  if not found:raise RuntimeError('No existing sitemap matched public file; no remote file was changed')
  ftp.cwd(found)
  if old!=data:
   temporary=NAME+'.upload-'+hashlib.sha256(data).hexdigest()[:12]
   ftp.storbinary('STOR '+temporary,io.BytesIO(data))
   check=io.BytesIO();ftp.retrbinary('RETR '+temporary,check.write)
   if check.getvalue()!=data:raise RuntimeError('Uploaded sitemap did not match')
   ftp.rename(temporary,NAME)
 with request.urlopen(URL+'?verify='+hashlib.sha256(data).hexdigest()[:12],timeout=60) as r:actual=r.read()
 if actual!=data:raise RuntimeError('Public sitemap differs after deployment')
 report=Path('catalog-image-report.json')
 if report.exists():
  result=json.loads(report.read_text());result.update(sitemapPublished=True,sitemapUrl=URL,uploadError=None)
  report.write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print('VERIFIED stable sitemap URL:',URL,'bytes',len(data),flush=True)
if __name__=='__main__':main()
