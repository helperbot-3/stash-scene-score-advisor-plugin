"""Seed only the isolated local advisor test server (never a user's library)."""
import json
import urllib.request
URL = 'http://127.0.0.1:19998/graphql'
def query(text, variables=None):
    request=urllib.request.Request(URL, data=json.dumps({'query':text,'variables':variables or {}}).encode(),headers={'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request))
    if result.get('errors'): raise RuntimeError(result['errors'])
    return result['data']
existing=query('{findScenes(filter:{per_page:1}){count}}')['findScenes']['count']
if existing: raise RuntimeError('Expected an empty test library; refusing to seed.')
tags=[query('mutation($name:String!){tagCreate(input:{name:$name}){id}}',{'name':name})['tagCreate']['id'] for name in ['Natural light','Good audio','Shaky camera','One-off tag']]
for i in range(64):
    chosen=([tags[0]] if i%2 else [])+([tags[1]] if i%4>=2 else [])+([tags[2]] if i%8>=4 else [])+([tags[3]] if i==0 else [])
    query('mutation($input:SceneCreateInput!){sceneCreate(input:$input){id}}',{'input':{'title':f'Demo scene {i+1:02d}','rating100':60+(20 if i%2 else 0)-(20 if i%8>=4 else 0) if i<48 else None,'tag_ids':chosen}})
print('Created 64 synthetic scenes, including 48 rated scenes.')
