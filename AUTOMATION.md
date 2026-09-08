# Guia de Automação: MomAI Desktop

A extensão MomAI Desktop permite abrir programas, pastas e arquivos no computador local automaticamente em resposta a eventos.

## Actions (Ações Executáveis)

1. **`momai-desktop.open_local_item`**
   - Executa um programa, script ou abre uma pasta/arquivo no Windows.
   - **Parâmetros**:
     - `path`: Caminho absoluto do aplicativo ou pasta a ser aberto (ex.: `"C:\\Windows\\System32\\calc.exe"` ou `"C:\\Users\\wesle\\dev"`)
     - `name` *(opcional)*: Rótulo amigável para exibição nos logs de automação

## Exemplos Práticos de Automação

1. **Abrir pasta de trabalho ou aplicativo ao iniciar o dia**:
   - **Trigger**: `time.cron` (ex.: `{ "cron": "0 9 * * 1-5" }` — 09:00 de segunda a sexta)
    - **Ação**: `momai-desktop.open_local_item`
     - `path`: `"C:\\Users\\wesle\\dev"`
     - `name`: `"Workspace Dev"`

## Modelo Se-em-lista (Hub de Automações)

- **Vários gatilhos (OU)**: `trigger_ids: ["time.cron", "<outra_ext>.<evento>"]` — qualquer um dispara. `trigger_configs` leva params por gatilho (ex.: `{ "time.cron": { "cron": "0 9 * * 1-5" } }`).
- **Condições (E)** em `global_conditions`, cada uma com `kind`:
  - `"trigger_field"` (padrão): `trigger.payload.<campo>`;
  - `"time_window"`: `time.time` (HH:MM, `between`/`equals`), `time.weekday` (`in`, 0=dom–6=sáb), `time.hour`, `time.date`;
  - `"extension_state"`: `extension.<id>.enabled` true/false.
- **Frequência (`policy`)**: `cooldownSeconds`, `maxPerDay`, `weekdays`, `startTime`/`endTime` (HH:MM), `expiresAt`. Omita para executar sempre.
