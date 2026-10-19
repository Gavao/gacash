# GACash

Spese ed entrate, budget per categoria, spese fisse e abbonamenti che si registrano da soli, scontrini e garanzie.

- **Dati solo sul telefono** (IndexedDB): niente account, niente banca collegata. Il backup è un file da salvare
  o condividere (comprende le foto degli scontrini); c'è anche l'esportazione CSV per Excel.
- **Android**: APK "guscio" (cartella `android/`) che apre l'app pubblicata su GitHub Pages e si aggiorna da solo;
  per gli scontrini apre la Fotocamera o la galleria.
- **iPhone**: aprire https://gavao.github.io/gacash/ in Safari → Condividi → Aggiungi alla schermata Home.

## Comandi
- Prova in locale: `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:8097
- Pubblica: `powershell -ExecutionPolicy Bypass -File tools\publish.ps1 "Descrizione"`
- APK: `powershell -ExecutionPolicy Bypass -File android\build.ps1` (con `-Release` lo pubblica su GitHub)
