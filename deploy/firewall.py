#!/usr/bin/env python3
"""Project-scoped Docker egress rules. Never flush a global chain."""
import json, subprocess, sys

def run(*args,check=True):
    return subprocess.run(args,check=check,capture_output=True,text=True)
def rule(chain,*args): run('iptables','-w','-A',chain,*args)
def ensure_chain(name):
    run('iptables','-w','-N',name,check=False)
    run('iptables','-w','-F',name)
def jump(parent,name):
    if run('iptables','-w','-C',parent,'-j',name,check=False).returncode:
        run('iptables','-w','-I',parent,'1','-j',name)
ids=run('docker','ps','-aq','--filter','label=com.docker.compose.project=bizroam').stdout.split()
if not ids: sys.exit('No Bizroam containers found')
containers=json.loads(run('docker','inspect',*ids).stdout)
services={c['Config']['Labels']['com.docker.compose.service']:c for c in containers}
if not {'web','tools','worker'} <= services.keys(): sys.exit('Expected all three Bizroam services')
ensure_chain('BIZROAM-OUT');ensure_chain('BIZROAM-HOST')
ips={name:[v['IPAddress'] for v in c['NetworkSettings']['Networks'].values() if v['IPAddress']] for name,c in services.items()}
for name,addresses in ips.items():
    for ip in addresses:
        rule('BIZROAM-OUT','-s',ip,'-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT')
        if name in ('web','worker'):
            for dest in ips['tools']:
                rule('BIZROAM-OUT','-s',ip,'-d',dest,'-p','tcp','--dport','3001','-j','ACCEPT')
        for network in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16','127.0.0.0/8','100.64.0.0/10'):
            rule('BIZROAM-OUT','-s',ip,'-d',network,'-j','REJECT')
        if name in ('tools','worker'):
            rule('BIZROAM-OUT','-s',ip,'-p','tcp','--dport','443','-j','ACCEPT')
        rule('BIZROAM-OUT','-s',ip,'-j','REJECT')
        rule('BIZROAM-HOST','-s',ip,'-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT')
        rule('BIZROAM-HOST','-s',ip,'-j','REJECT')
rule('BIZROAM-OUT','-j','RETURN');rule('BIZROAM-HOST','-j','RETURN')
jump('DOCKER-USER','BIZROAM-OUT');jump('INPUT','BIZROAM-HOST')
print('Bizroam-only network isolation installed')
