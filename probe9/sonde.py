# Sonde n°9 : zones protégées et forêts publiques sur la Géoplateforme (WFS), pour la Savoie et la Haute-Savoie.
import json, re, sys, urllib.parse, urllib.request

WFS = 'https://data.geopf.fr/wfs'
BBOX = '45.0,5.6,46.45,7.25,urn:ogc:def:crs:EPSG::4326'  # lat/lon en WFS 2.0

def get(params, origin=False):
    url = WFS + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Origin': 'https://aligotaure.github.io'} if origin else {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read()
    except Exception as e:
        return getattr(e, 'code', 0), {}, str(e).encode()

st, _, caps = get({'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetCapabilities'})
x = caps.decode('utf-8', 'replace')
print('capacités', st, len(x), 'octets')
names = []
for m in re.finditer(r'<(?:\w+:)?FeatureType\b[^>]*>(.*?)</(?:\w+:)?FeatureType>', x, re.S):
    b = m.group(1)
    n = re.search(r'<(?:\w+:)?Name>(.*?)</(?:\w+:)?Name>', b)
    t = re.search(r'<(?:\w+:)?Title>(.*?)</(?:\w+:)?Title>', b)
    name, title = (n.group(1) if n else ''), (t.group(1) if t else '')
    if re.search(r'PROTECTEDAREA|FORETS?\.PUBLIQUE|FORET_PUBLIQUE|RESERVE|BIOTOPE|PARC', name + ' ' + title, re.I):
        names.append(name)
        print('TYPE', name, '|', title)
print(len(names), 'types retenus')

for name in names:
    if not re.search(r'PROTECTEDAREAS\.(RN|RNR|RNC|APB|APG|APHN|PN|RB|RIPN|RNCFS|BIOS|PNR)\b|FORETS\.PUBLIQUE', name, re.I):
        continue
    base = {'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': name, 'BBOX': BBOX}
    st, h, body = get({**base, 'RESULTTYPE': 'hits'})
    hits = re.search(r'numberMatched="(\d+|unknown)"', body.decode('utf-8', 'replace'))
    print('\n==', name, 'hits', st, hits.group(1) if hits else body[:200])
    st, h, body = get({**base, 'OUTPUTFORMAT': 'application/json', 'COUNT': '5000', 'SRSNAME': 'EPSG:4326'}, origin=True)
    print('   geojson', st, len(body), 'octets', 'CORS', h.get('Access-Control-Allow-Origin'), h.get('Content-Type'))
    try:
        fc = json.loads(body)
        feats = fc.get('features', [])
        print('   objets', len(feats), 'numberMatched', fc.get('numberMatched'), 'crs', json.dumps(fc.get('crs'))[:120])
        if feats:
            f0 = feats[0]
            print('   géométrie', f0['geometry']['type'] if f0.get('geometry') else None, 'nom de la colonne', fc.get('features')[0].get('geometry_name'))
            print('   propriétés', json.dumps(f0.get('properties'), ensure_ascii=False)[:700])
            keys = [k for k in f0['properties'] if re.search(r'nom|name|lib|site|type|cat|gest|url|lien|titre', k, re.I)]
            for f in feats[:60]:
                print('     -', ' | '.join(str(f['properties'].get(k))[:60] for k in keys[:5]))
            if len(feats) > 60:
                print('     … et', len(feats) - 60, 'autres')
    except Exception as e:
        print('   pas du GeoJSON :', e, body[:300])
