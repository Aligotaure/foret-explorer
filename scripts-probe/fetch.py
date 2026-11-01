# Données réelles autour du Parmelan pour l'aperçu local de la grille fine (sonde temporaire).
import json, math, os, sys, time, urllib.request

out = sys.argv[1]
W, S, E, N = 6.10, 45.88, 6.32, 45.99
HEADERS = {'User-Agent': 'foret-explorer-sonde', 'Origin': 'https://aligotaure.github.io'}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def save(url, path):
    try:
        data = fetch(url)
    except Exception as e:
        print('ERREUR', url, e)
        return 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


total = 0
for z in (12, 13, 14):
    x0, y0 = tile_xy(W, N, z)
    x1, y1 = tile_xy(E, S, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            total += save(f'https://data.geopf.fr/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2/{z}/{x}/{y}.pbf', f'{out}/tuiles/bdforet/{z}/{x}/{y}.pbf')
            if z <= 13:
                total += save(f'https://aligotaure.github.io/foret-explorer/data/geologie/{z}/{x}/{y}.pbf', f'{out}/tuiles/geologie/{z}/{x}/{y}.pbf')
print('octets de tuiles', total)

# Altitudes IGN au centre des carrés de la grille fine (même découpage que src/fineGrid.ts).
D = 9
FLAT, FLON = 0.04 / D, 0.056 / D
cells = []
for i in range(math.floor(S / FLAT), math.floor(N / FLAT) + 1):
    for j in range(math.floor(W / FLON), math.floor(E / FLON) + 1):
        cells.append((f'{i}:{j}', j * 0.056 / D + FLON / 2, i * 0.04 / D + FLAT / 2))
alts = {}
for k in range(0, len(cells), 200):
    chunk = cells[k:k + 200]
    q = ('lon=' + '%7C'.join(f'{c[1]:.5f}' for c in chunk) + '&lat=' + '%7C'.join(f'{c[2]:.5f}' for c in chunk)
         + '&resource=ign_rge_alti_wld&zonly=true')
    try:
        data = json.loads(fetch('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?' + q))
        for c, z in zip(chunk, data['elevations']):
            alts[c[0]] = round(z) if z > -1000 else None
    except Exception as e:
        print('ERREUR altitude', k, e)
    time.sleep(0.4)
with open(f'{out}/altitudes.json', 'w') as f:
    json.dump(alts, f)
print('altitudes', len(alts))

# Météo Open-Meteo des cases de 4,5 km (même requête que src/weather.ts).
coarse = []
for i in range(math.floor((S - 0.05) / 0.04), math.floor((N + 0.05) / 0.04) + 1):
    for j in range(math.floor((W - 0.06) / 0.056), math.floor((E + 0.06) / 0.056) + 1):
        coarse.append((f'1:{i}:{j}', i * 0.04 + 0.02, j * 0.056 + 0.028))
url = ('https://api.open-meteo.com/v1/forecast?latitude=' + ','.join(f'{c[1]:.4f}' for c in coarse)
       + '&longitude=' + ','.join(f'{c[2]:.4f}' for c in coarse)
       + '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=20&forecast_days=1&timezone=Europe/Paris')
try:
    data = json.loads(fetch(url))
    with open(f'{out}/meteo.json', 'w') as f:
        json.dump({c[0]: d for c, d in zip(coarse, data)}, f)
    print('cases météo', len(coarse))
except Exception as e:
    print('ERREUR météo', e)
