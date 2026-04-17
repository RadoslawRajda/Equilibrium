# Equilibrium PoC

Equilibrium PoC to przegladowa gra strategiczno-ekonomiczna z lobby, mapa heksow, surowcami, barterem, glosowaniami i warstwa AI Game Master. Projekt jest zbudowany jako monorepo z trzema glowymi aplikacjami:

- frontend React/Vite do gry w przegladarce,
- backend Node.js/Express/Socket.IO dla logiki off-chain i synchronizacji,
- kontrakty Solidity uruchamiane lokalnie na Ganache przez Hardhat.

Aktualny model jest hybrydowy. Frontend czyta stan gry z lokalnego chaina i sam liczy odliczanie rundy w UI, a backend nadal wystawia API, Socket.IO i warstwe AI. Deploymenty kontraktow sa synchronizowane miedzy kontraktami i frontendem, zeby ABI nie rozjezdzaly sie przy zmianach.

## Co robi projekt

Gra prowadzi gracza przez nastepujace etapy:

1. zalozenie lobby i zakup biletu,
2. start gry i runde zerowa,
3. wybor startowego heksa,
4. eksploracje sasiednich heksow,
5. budowe i ulepszanie struktur,
6. zbieranie surowcow,
7. barter p2p,
8. glosowania nad propozycjami,
9. automatyczne lub reczne przejscia rund,
10. zdarzenia AI Game Master.

## Aktualizacja 2026-04-11: co zostalo zrobione i jak

W tej iteracji domknieto glowny kierunek ADR "on-chain gameplay as source of truth" i przetestowano go.

1. Backend jest read-only i nie ma juz gameplay authority.
2. Frontend czyta stan i koszty akcji z kontraktow przez warstwe repozytorium.
3. Kontrakty dostaly seam pod session keys, sponsoring i flow kompatybilny z ERC-4337.
4. Dodano adapter AI kompatybilny z podejsciem ERC-8004 (agent jako modul, bez twardego zaszycia logiki AI w reguly gry).

Najwazniejsze pliki po zmianie:

1. backend read-only API: [backend/src/app.js](backend/src/app.js)
2. backend startup: [backend/src/index.js](backend/src/index.js)
3. frontend repository + testy: [frontend/src/lib/lobbyRepository.ts](frontend/src/lib/lobbyRepository.ts), [frontend/src/lib/lobbyRepository.test.ts](frontend/src/lib/lobbyRepository.test.ts)
4. frontend utils + testy: [frontend/src/lib/gameUtils.ts](frontend/src/lib/gameUtils.ts), [frontend/src/lib/gameUtils.test.ts](frontend/src/lib/gameUtils.test.ts)
5. 4337 hooks: [contracts/contracts/AAHooks.sol](contracts/contracts/AAHooks.sol)
6. ERC-8004 adapters: [contracts/contracts/ERC8004Adapters.sol](contracts/contracts/ERC8004Adapters.sol)

### OpenZeppelin templates i wzorce

Nowe kontrakty adapterowe nie sa juz pisane "od zera" pod ownership i safety. Uzyto gotowych komponentow OpenZeppelin:

1. `Ownable2Step` do bezpieczniejszego przekazywania uprawnien administracyjnych.
2. `ReentrancyGuard` dla sciezek transferu/sponsoringu.
3. `ERC165`/`IERC165` do walidacji, ze agent AI implementuje oczekiwany interfejs.
4. `ERC721` (Ticket) pozostaje oparty o OpenZeppelin template.

To daje bardziej standardowy i audytowalny kod przy zachowaniu modulow pod 4337 i AI.

## Struktura katalogow

- [backend](backend) - serwer Express + Socket.IO, engine gry off-chain, AI i synchronizacja z kontraktami.
- [contracts](contracts) - Hardhat, Solidity, testy i deploymenty lokalne.
- [frontend](frontend) - aplikacja Vite/React z mapą heksow i UI do gry.
- [docker-compose.yml](docker-compose.yml) - lokalny stack uruchomieniowy dla Ganache, Hardhat, backendu i frontendu.

## Architektura

### Frontend

Frontend jest napisany w React + Vite i uzywa:

- wagmi i viem do odczytow i zapisow na chainie,
- react-router-dom do routingu lobby i gry,
- react-hexgrid do mapy heksow,
- react-zoom-pan-pinch do zoom/pan,
- Framer Motion i canvas-confetti do animacji UI.

W praktyce UI:

- pobiera deploymenty kontraktow z [frontend/src/deployments/localhost.json](frontend/src/deployments/localhost.json),
- czyta dane lobby i mapy z kontraktow,
- liczy timer rundy lokalnie na podstawie `roundStartedAt` i `roundDurationSeconds`,
- odswieza stan po transakcjach oraz przy okresowym polling'u,
- pokazuje koszt akcji bez zgadywania po stronie gracza.

### Backend

Backend to Node.js + Express + Socket.IO. W obecnej wersji pelni role:

- HTTP API dla health check i listy lobby,
- warstwy Socket.IO dla akcji gameplay,
- walidacji podpisow wiadomości,
- integracji z Ollama dla AI Game Master,
- synchronizacji stanu z kontraktami i engine off-chain.

Najwazniejsze endpointy HTTP:

- `GET /health` - status procesu,
- `GET /api/lobbies` - lista lobby,
- `GET /api/contracts` - aktualny deployment kontraktow.

Najwazniejsze eventy Socket.IO:

- `game:start`
- `game:end-round`
- `game:pick-start`
- `game:discover`
- `game:build`
- `game:upgrade`
- `game:collect`
- `barter:create`
- `barter:accept`
- `vote:create`
- `vote:cast`
- `lobby:watch`

Kazda akcja websocketowa jest podpisywana, ma `timestamp` i `nonce`, a backend broni sie przed replay i przeterminowanymi podpisami.

### Kontrakty

Kontrakty sa kompilowane i deployowane lokalnie przez Hardhat. W deploymentach znajduja sie:

- `LobbyManager`
- `AIGameMaster`
- `GameCore`

W projekcie istnieja takze dodatkowe kontrakty domenowe dla roznych aspektow gry, m.in. Ticket, Season, PlayerState, Structures i Voting.

Wazne zasady po stronie `GameCore`:

- `getLobbyRound` zwraca indeks rundy, timestamp konca rundy zerowej, timestamp konca aktualnej rundy, status, timestamp startu rundy i dlugosc rundy,
- runda moze przeskoczyc o wiecej niz 1 przy nastepnej transakcji, jesli czas juz minal,
- budowa lvl1 kosztuje `food/wood/stone = 10/10/10`,
- upgrade do lvl2 kosztuje `food/stone/ore = 30/30/30`,
- odkrywanie heksa wymaga sasiedztwa z posiadanym hexem i ma koszt rosnacy wraz z liczba posiadanych hexow,
- frontend pokazuje te koszty bez czekania na reczny refresh.

## Mechanika gry

### Runda zerowa

W rundzie zerowej gracze wybieraja heks startowy. Po zakonczeniu rundy zerowej gra przechodzi do rund glownych. Jesli wszyscy gracze wybiora heksy szybciej, runda moze przejsc automatycznie.

### Eksploracja

Odkrywanie i zajmowanie nowych heksow jest ograniczone do heksow sasiednich wobec juz posiadanych terenow. Koszt eksploracji:

- startowo `40` z kazdego z czterech surowcow,
- potem roslinie wedlug mnoznika `x1.5` za kolejny posiadany hex.

### Budowa i ulepszenia

- lvl1: koszt `10 food`, `10 wood`, `10 stone`.
- lvl2: koszt `30 food`, `30 stone`, `30 ore`.

Budowac i ulepszac mozna tylko na swoim hexie. Ulepszenie wymaga istniejacej struktury lvl1.

### Zbieranie

Zbieranie surowcow zuzywa energie, a produkcja zaczyna sie od kolejnej rundy po postawieniu struktury.

### Glosowania i barter

Projekt wspiera tworzenie propozycji, glosowania oraz barter p2p. Propozycje moga miec zwykle efekty albo specjalny tryb zakonczenia rundy.

### AI Game Master

Backend probuje uzywac Ollama jako silnika AI. Jesli model jest niedostepny, przechodzi na fallback. Dzieki temu gra nadal dziala lokalnie, nawet bez uruchomionego LLM.

## Konfiguracja

### Backend

- `PORT` - port HTTP, domyslnie `4000`.
- `RPC_URL` - adres RPC Ganache, domyslnie `http://localhost:8545`.
- `OLLAMA_URL` - adres Ollama, domyslnie `http://localhost:11434`.
- `OLLAMA_MODEL` - model AI, domyslnie `llama3.2`.
- `ROUND_DURATION_MS` - dlugosc rundy, domyslnie `300000`.
- `ZERO_ROUND_DURATION_MS` - dlugosc rundy zerowej, domyslnie `300000`.
- `DEPLOYMENTS_PATH` - sciezka do deployment JSON z kontraktami.

### Frontend

- `VITE_CHAIN_ID` - lokalny chain id, domyslnie `1337`.
- `VITE_RPC_URL` - local RPC, domyslnie `http://localhost:8545`.
- `VITE_BUNDLER_URL` - wymagany endpoint bundlera ERC-4337 (eth_sendUserOperation).
- `VITE_ENTRYPOINT_ADDRESS` - opcjonalny adres EntryPoint; domyslnie EntryPoint v0.7.
- `VITE_PAYMASTER_URL` - opcjonalny endpoint paymastera (gdy sponsoring gazu jest wlaczony).
- `VITE_BACKEND_URL` - adres backendu, uzywany przez infrastrukture i integracje.
- `VITE_WALLETCONNECT_PROJECT_ID` - project id dla WalletConnect.

Frontend ma plik [frontend/.env.local](frontend/.env.local), a deploymenty kontraktow sa synchronizowane automatycznie przed startem i buildem przez skrypt `frontend/scripts/sync-deployments.mjs`.

## Uruchomienie lokalne

### Przez Docker Compose

Najprostsza droga to caly stack:

```bash
docker compose up --build
```

Stack uruchamia:

- Ganache na `http://localhost:8545`,
- Hardhat deployujacy kontrakty do Ganache,
- backend na `http://localhost:4000`,
- frontend na `http://localhost:3000`.

### Ollama

Jesli chcesz pelny tryb AI, uruchom Ollama lokalnie:

```bash
ollama serve
ollama pull llama3.2
```

Jesli Ollama nie dziala, backend moze korzystac z fallbacku AI.

## Praca nad projektem

### Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
```

### Backend

```bash
cd backend
npm install
npm run dev
```

### Kontrakty

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network ganache
```

## Pliki generowane i loklane artefakty

W repo wystepuja pliki generowane przy buildzie lub uruchomieniu stacku. W szczegolnosci:

- `frontend/dist`
- `contracts/artifacts`
- `contracts/cache`
- `node_modules` w kazdym module
- lokalne pliki `.env.local`

Te pliki sa celowo wykluczone przez `.gitignore`.

## Uwaga o stanie gry

Frontend czyta stan gry bezposrednio z chaina i odswieza go po transakcjach. Round timer jest liczony lokalnie w UI z danych z kontraktu, wiec wskaznik czasu moze sie przesunac tylko wtedy, gdy stan on-chain zmieni go po czyims tx albo przy nastepnej synchronizacji.

## Licencja

Brak osobnej licencji w repo. Jezeli chcesz opublikowac projekt, dodaj odpowiedni plik licencyjny.
