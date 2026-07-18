# Arquitetura inicial

## Princípios

- **Offline primeiro:** o usuário registra e consulta o histórico sem internet.
- **Dados como fonte de verdade:** cada treino e sua estrutura de sets são preservados; totais, PRs e gráficos são derivados.
- **Recuperação em camadas:** cache local, sincronização remota, snapshots e exportação pessoal.

## Primeira fatia entregue

```text
React PWA → IndexedDB → treino validado → histórico local
```

O armazenamento local usa IndexedDB no navegador. Ele é propositalmente isolado em `src/lib/db.ts`, permitindo adicionar uma fila de sincronização sem alterar as telas.

## Backup local

O menu **Dados** exporta um documento JSON versionado. Na importação, o arquivo é validado integralmente antes de qualquer gravação. Registros com o mesmo identificador são mesclados pela versão mais recente (`updatedAt`), portanto restaurar um backup não deve duplicar treinos existentes.

Exclusões são lógicas: o treino recebe `deletedAt` e fica fora dos totais e gráficos, mas permanece no backup para uma recuperação posterior.

## Modelo de domínio

```text
Workout
  id
  performedAt
  targetReps
  durationSeconds
  notes
  createdAt / updatedAt

WorkoutSetGroup
  id
  workoutId (implícito dentro do registro local nesta fase)
  sequence (na próxima migração)
  setCount
  repsPerSet
```

Para `100 = 2 × 50`, o treino mantém `targetReps = 100` e um grupo de sets com `setCount = 2` e `repsPerSet = 50`.

## Próxima arquitetura de sincronização

```text
PWA / IndexedDB
       ↕ fila de mudanças idempotentes
Cloudflare Worker
       ↕
Cloudflare D1 (registro principal)
       ↘ snapshot diário imutável
         Cloudflare R2
```

Cada alteração terá UUID, versão e data. O servidor validará novamente os dados antes de gravar. Exclusões serão lógicas e poderão ser restauradas durante a janela de retenção.

## Critérios de aceite da próxima etapa

1. Criar um treino offline.
2. Fechar e abrir o app: o treino ainda existe.
3. Reabrir com rede: a fila é sincronizada sem duplicação.
4. Entrar em outro dispositivo: o histórico é restaurado.
5. Exportar e restaurar um backup completo com validação de checksum.
