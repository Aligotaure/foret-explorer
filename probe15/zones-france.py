# Sonde n°15 : nombre d'objets des couches de zones sur toute la France métropolitaine.
import re, urllib.parse, urllib.request
WFS = 'https://data.geopf.fr/wfs'
BBOX = '41.2,-5.3,51.2,9.7,urn:ogc:def:crs:EPSG::4326'
for t in ['patrinat_rnn:rnn', 'patrinat_rnr:rnr', 'patrinat_pprnn:pprnn', 'patrinat_pprnr:pprnr', 'patrinat_rb:rb', 'patrinat_pn:parc_national', 'patrinat_apb:apb', 'patrinat_aphn:aphn', 'patrinat_cdl:conservatoire_littoral', 'patrinat_cen:cen', 'BDTOPO_V3:foret_publique']:
    q = urllib.parse.urlencode({'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': t, 'RESULTTYPE': 'hits', 'BBOX': BBOX})
    try:
        body = urllib.request.urlopen(f'{WFS}?{q}', timeout=120).read().decode()
        m = re.search(r'numberMatched="(\d+)"', body)
        print(t, m.group(1) if m else body[:120])
    except Exception as e:
        print(t, 'erreur', e)
