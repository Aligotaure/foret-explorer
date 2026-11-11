# Sonde n°23 : que répond l'IGN pour des tuiles BD Forêt hors de France (aperçu raster et tuiles vectorielles) ?
import math, subprocess

def tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

def code(url):
    out = subprocess.run(['curl', '-sS', '-m', '30', '-o', '/tmp/t', '-w', '%{http_code} %{size_download}', '-H', 'Origin: https://aligotaure.github.io', url], capture_output=True, text=True)
    return out.stdout.strip() or out.stderr.strip()[:60]

places = [
    ('Paris', 48.85, 2.35), ('Vosges', 48.06, 6.9), ('Corse', 42.12, 9.13),
    ('Suisse (Lausanne)', 46.6, 7.0), ('Italie (Milan)', 45.46, 9.19), ('Espagne (Barcelone)', 41.39, 2.17),
    ('golfe de Gascogne', 45.5, -4.0), ('Méditerranée', 42.2, 5.0),
    ('Allemagne (Munich)', 48.14, 11.58), ('Londres', 51.5, -0.12), ('Irlande', 53.3, -7.5), ('Madrid', 40.4, -3.7),
    ('Guadeloupe', 16.25, -61.55), ('La Réunion', -21.1, 55.5), ('Guyane', 4.9, -52.3),
]
W = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&STYLE=normal&LAYER=LANDCOVER.FORESTINVENTORY.V2&TILEMATRIXSET=PM_6_16&FORMAT=image/png'
print('lieu | aperçu z6 | aperçu z9 | vecteur z10 | vecteur z12')
for name, lat, lon in places:
    row = [name]
    for z in (6, 9):
        x, y = tile(lat, lon, z)
        row.append(f'{z}/{x}/{y} → ' + code(f'{W}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'))
    for z in (10, 12):
        x, y = tile(lat, lon, z)
        row.append(f'{z}/{x}/{y} → ' + code(f'https://data.geopf.fr/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2/{z}/{x}/{y}.pbf'))
    print(' | '.join(row))
