# Timeline du cold start

Intervalles depuis la navigation ; fonctions inclusives, pistes simultanées. Les durées des API comprennent leur réception côté navigateur, pas uniquement le temps serveur.

## Ancienne base — passage médian

| Piste | Intervalles début → fin (ms) |
|---|---|
| HTML | 0.0 → 92.0 |
| Snapshot léger | 199.3 → 458.0 |
| Utilisateurs | 475.5 → 489.0 |
| Droits | 489.4 → 504.5 |
| Employés, tous appels | 562.3 → 693.4 ; 1138.4 → 1316.2 |
| Candidats | 562.5 → 631.1 |
| Sidebar, tous appels | 513.4 → 1031.2 ; 1138.7 → 1235.2 ; 1378.5 → 1414.6 |
| Sync SQL, attente incluse | 562.0 → 866.4 |
| Transformations JS | 199.4 → 199.4 ; 462.6 → 467.0 ; 467.0 → 467.0 ; 467.0 → 467.0 ; 467.0 → 471.9 ; 508.3 → 508.3 ; 635.3 → 635.4 ; 713.6 → 716.9 ; 985.3 → 988.4 ; 1134.5 → 1136.2 ; 1235.6 → 1237.1 ; 1325.0 → 1327.2 |
| Téléchargements modules | 990.8 → 1002.6 ; 1101.5 → 1115.0 ; 1101.7 → 1112.2 |
| Rendu dashboard | 1138.6 → 1176.9 |
| Écritures DOM | 203.1 → 203.1 ; 508.6 → 508.6 ; 717.1 → 717.1 ; 988.5 → 988.6 ; 1175.4 → 1176.8 |

Premier affichage : **1234.2 ms**. JSON parse cumulé : 15.6 ms ; init modules : 0 ms ; images/documents : 0/0.

## Ancienne branche — passage médian

| Piste | Intervalles début → fin (ms) |
|---|---|
| HTML | 0.0 → 139.5 |
| Snapshot léger | 290.1 → 1230.6 |
| Utilisateurs | 1250.5 → 1289.6 |
| Droits | 1290.3 → 1321.7 |
| Employés, tous appels | 1413.3 → 1698.1 |
| Candidats | 1413.8 → 1619.1 |
| Sidebar, tous appels | 1217.3 → 1426.1 ; 1680.4 → 2003.6 |
| Sync SQL, attente incluse | 1411.6 → 1827.0 |
| Transformations JS | 290.6 → 290.7 ; 1237.4 → 1245.4 ; 1245.2 → 1245.2 ; 1245.4 → 1245.4 ; 1245.4 → 1247.9 ; 1343.8 → 1343.8 ; 1622.4 → 1622.5 ; 1710.3 → 1712.3 ; 1951.8 → 1956.2 ; 2208.7 → 2214.0 |
| Téléchargements modules | 1963.8 → 1970.6 ; 2002.1 → 2009.1 ; 2002.2 → 2010.5 |
| Rendu dashboard | 2218.3 → 2274.2 |
| Écritures DOM | 401.4 → 401.4 ; 1344.3 → 1344.4 ; 1712.4 → 1712.5 ; 1956.6 → 1956.7 ; 2272.7 → 2274.2 |

Premier affichage : **2411.8 ms**. JSON parse cumulé : 10.2 ms ; init modules : 0.1 ms ; images/documents : 0/0.

## Branche — nouvelle médiane

| Piste | Intervalles début → fin (ms) |
|---|---|
| HTML | 0.0 → 83.9 |
| Snapshot léger | 277.4 → 462.2 |
| Utilisateurs | 481.0 → 490.3 |
| Droits | 490.4 → 498.0 |
| Employés, tous appels | 554.8 → 678.6 |
| Candidats | 555.1 → 608.1 |
| Sidebar, tous appels | 505.2 → 956.7 |
| Sync SQL, attente incluse | 554.4 → 807.8 |
| Transformations JS | 277.5 → 277.6 ; 469.2 → 474.3 ; 474.3 → 474.3 ; 474.3 → 474.3 ; 474.3 → 476.6 ; 501.0 → 501.0 ; 611.6 → 611.6 ; 694.4 → 697.6 ; 921.4 → 924.6 ; 1034.8 → 1036.4 |
| Téléchargements modules | 926.2 → 936.6 ; 1013.6 → 1028.7 ; 1013.7 → 1024.6 |
| Rendu dashboard | 1039.2 → 1066.4 |
| Écritures DOM | 280.5 → 280.5 ; 501.3 → 501.4 ; 697.8 → 697.9 ; 924.8 → 924.9 ; 1065.1 → 1066.3 |

Premier affichage : **1096.9 ms**. JSON parse cumulé : 11.8 ms ; init modules : 0 ms ; images/documents : 0/0.
