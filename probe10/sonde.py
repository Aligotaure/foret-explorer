# Sonde n°10 : forêts publiques, parcs et réserves (BD TOPO), espaces protégés PatriNat, points de rencontre des secours.
import collections, json, re, urllib.parse, urllib.request

WFS = 'https://data.geopf.fr/wfs'
BBOX = '45.0,5.6,46.45,7.25,urn:ogc:def:crs:EPSG::4326'

def get(params, origin=False):
    url = WFS + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Origin': 'https://aligotaure.github.io'} if origin else {})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, dict(r.headers), r.read()
    except Exception as e:
        return getattr(e, 'code', 0), {}, str(e).encode()

st, _, caps = get({'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetCapabilities'})
x = caps.decode('utf-8', 'replace')
types = []
for m in re.finditer(r'<(?:\w+:)?FeatureType\b[^>]*>(.*?)</(?:\w+:)?FeatureType>', x, re.S):
    b = m.group(1)
    n = re.search(r'<(?:\w+:)?Name>(.*?)</(?:\w+:)?Name>', b)
    t = re.search(r'<(?:\w+:)?Title>(.*?)</(?:\w+:)?Title>', b)
    types.append((n.group(1) if n else '', t.group(1) if t else ''))
print('patrinat :')
for n, t in types:
    if n.lower().startswith('patrinat') or 'PROTECTEDAREAS' in n:
        print('  ', n, '|', t)
print('BDTOPO_V3 :', ', '.join(n.split(':')[1] for n, t in types if n.startswith('BDTOPO_V3:')))

def vertices(g):
    if not g: return 0
    c = g.get('coordinates')
    def count(a):
        return 1 if a and isinstance(a[0], (int, float)) else sum(count(b) for b in a)
    return count(c) if c else 0

wanted = ['BDTOPO_V3:foret_publique', 'BDTOPO_V3:parc_ou_reserve', 'PROTECTEDAREAS.PRSF:prsf']
wanted += [n for n, t in types if n.lower().startswith('patrinat') and n not in wanted]
for name in wanted:
    base = {'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': name, 'BBOX': BBOX}
    st, h, body = get({**base, 'RESULTTYPE': 'hits'})
    hits = re.search(r'numberMatched="(\d+|unknown)"', body.decode('utf-8', 'replace'))
    print('\n==', name, 'hits', st, hits.group(1) if hits else body[:160])
    if not hits or hits.group(1) in ('0', 'unknown') and 'patrinat' in name and name not in ('patrinat_apb:apb', 'patrinat_pn:parc_national'):
        continue
    feats, size, cors = [], 0, None
    for start in range(0, 20000, 5000):
        st, h, body = get({**base, 'OUTPUTFORMAT': 'application/json', 'COUNT': '5000', 'STARTINDEX': str(start), 'SRSNAME': 'EPSG:4326'}, origin=True)
        cors = cors or h.get('Access-Control-Allow-Origin')
        size += len(body)
        try:
            page = json.loads(body).get('features', [])
        except Exception as e:
            print('   erreur', st, body[:200]); break
        feats += page
        if len(page) < 5000: break
    print('   objets', len(feats), 'octets', size, 'sommets', sum(vertices(f.get('geometry')) for f in feats), 'CORS', cors)
    if not feats: continue
    props = feats[0]['properties']
    print('   champs', ', '.join(props.keys()))
    print('   exemple', json.dumps(props, ensure_ascii=False)[:600])
    for k in props:
        if re.search(r'nature|type|cat|statut|gestion|zone|regl', k, re.I):
            c = collections.Counter(str(f['properties'].get(k)) for f in feats)
            print('   valeurs de', k, ':', dict(c.most_common(25)))
    for k in props:
        if re.search(r'toponyme|nom|name|libelle', k, re.I):
            print('   noms (', k, ') :', ' ; '.join(sorted({str(f['properties'].get(k)) for f in feats})[:70]))
            break
