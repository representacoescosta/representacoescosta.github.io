"""Gera dados/referencias/{uf,municipios,cnae}.json a partir dos arquivos oficiais do IBGE:
   DTB (Divisão Territorial Brasileira, geoftp.ibge.gov.br) e CNAE 2.3 subclasses (concla.ibge.gov.br).
   Uso: python ibge.py <pasta_downloads> <pasta_saida>"""
import json, re, sys, glob, zipfile, unicodedata
import pandas as pd

ent, sai = sys.argv[1], sys.argv[2]
SIGLAS = {11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',
          31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'}
REGIOES = {1:'Norte',2:'Nordeste',3:'Sudeste',4:'Sul',5:'Centro-Oeste'}
def chave(s): return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii','ignore').decode().lower())

# ---- DTB: procura a planilha de municípios dentro do zip
z = zipfile.ZipFile(glob.glob(f'{ent}/DTB*.zip')[0])
nomes = [n for n in z.namelist() if re.search(r'munic', n, re.I) and re.search(r'\.(xls|xlsx|ods)$', n, re.I)]
nomes.sort(key=lambda n: (not n.lower().endswith('.xls'), n))
print('DTB arquivos:', nomes)
arq = z.extract(nomes[0], ent)
bruto = pd.read_excel(arq, header=None, dtype=str, engine='odf' if arq.lower().endswith('.ods') else None)
lin = next(i for i in range(20) if any('codigomunicipiocompleto' == chave(x) for x in bruto.iloc[i]))
df = bruto.iloc[lin+1:].copy(); df.columns = [chave(x) for x in bruto.iloc[lin]]
print('DTB colunas:', list(df.columns))
cuf = next(c for c in df.columns if c in ('uf', 'codigouf'))
cnuf = next(c for c in df.columns if c == 'nomeuf')
cnm = next(c for c in df.columns if c in ('nomemunicipio', 'nomedomunicipio'))
muns, ufs = [], {}
for _, r in df.iterrows():
    cod = str(r['codigomunicipiocompleto']).strip()
    if not re.fullmatch(r'\d{7}', cod): continue
    u = int(str(r[cuf]).strip()); muns.append({'id': int(cod), 'nome': str(r[cnm]).strip(), 'uf': u})
    ufs[u] = {'id': u, 'sigla': SIGLAS[u], 'nome': str(r[cnuf]).strip(), 'regiao': REGIOES[u // 10]}

# ---- CNAE 2.3 subclasses (estrutura detalhada): linhas hierárquicas Seção > Divisão > Grupo > Classe > Subclasse
c = pd.read_excel(glob.glob(f'{ent}/cnae.*')[0], header=None, dtype=str).fillna('')
cnae, secao = [], None
for _, r in c.iterrows():
    cel = [str(x).strip() for x in r.tolist()]
    txt = [x for x in cel if x]
    if not txt: continue
    if len(txt) >= 2 and re.fullmatch(r'[A-U]', txt[0]): secao = txt[0]; continue
    sub = next((x for x in cel if re.fullmatch(r'\d{4}-\d/\d{2}', x)), None)
    if sub:
        d = re.sub(r'\D', '', sub); desc = cel[-1] if cel[-1] and cel[-1] != sub else next(x for x in reversed(cel) if x and x != sub)
        cnae.append({'id': d, 'descricao': desc, 'classe': d[:5], 'grupo': d[:3], 'divisao': d[:2], 'secao': secao})

ufs = sorted(ufs.values(), key=lambda x: x['id']); muns.sort(key=lambda x: x['id'])
print(f'Estados: {len(ufs)} · Municípios: {len(muns)} · CNAE: {len(cnae)} · exemplo CNAE: {cnae[:1]}')
assert len(ufs) == 27 and len(muns) > 5500 and len(cnae) > 1300 and all(x['secao'] for x in cnae), 'Dados do IBGE incompletos'
for nome, dados in (('uf', ufs), ('municipios', muns), ('cnae', cnae)):
    json.dump(dados, open(f'{sai}/{nome}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
