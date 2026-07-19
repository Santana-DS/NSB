# NSB Tracker

Aplicativo pessoal, instalável e offline-first para registrar Navy Seal Burpees, tempo total e estratégias de sets.

## Estado atual

A primeira fatia funcional permite:

- selecionar uma meta entre 100 e 500 NSBs;
- informar data/hora, tempo total e sets opcionais;
- validar se os sets somam a meta escolhida;
- salvar o treino no dispositivo com IndexedDB;
- consultar o histórico e o melhor tempo de 100 NSBs.
- exportar e importar um backup JSON versionado;
- mover um treino para a lixeira e desfazer a exclusão durante a sessão.
- explorar o volume por anos, meses e dias diretamente no gráfico inicial.

Sincronização, autenticação, backup remoto e análises avançadas virão nas próximas etapas.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abra a URL exibida pelo Vite. Para testar no celular na mesma rede, use o endereço de rede exibido ao executar `npm run dev -- --host`.

```bash
npm test
npm run build
```

## Regras de domínio iniciais

- Metas permitidas: 100 a 500, em incrementos de 50.
- Tempo é armazenado em segundos, apresentado em `mm:ss`.
- Sets são opcionais; se existirem, a soma deve corresponder à meta.
- Estatísticas e PRs são derivados dos treinos, nunca gravados como uma segunda fonte de verdade.

Consulte [arquitetura inicial](docs/architecture.md) para os próximos componentes.
