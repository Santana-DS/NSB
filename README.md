# NSB Tracker

Aplicativo pessoal, instalável e offline-first para registrar Navy Seal Burpees, tempo total e estratégias de sets.

## Estado atual

A primeira fatia funcional permite:

- selecionar uma meta entre 100 e 500 NSBs;
- medir tempo com cronômetro ou informar manualmente, além de data/hora e sets opcionais;
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

## Android instalável

O projeto nativo Android está em `android/` e usa Capacitor. A interface React continua sendo a fonte única da interface; após qualquer mudança web, sincronize-a com:

```bash
npm run android:sync
```

Para gerar e instalar o APK de depuração, abra a pasta `android/` no Android Studio (com o SDK Android instalado) e execute o alvo `app`. O Android Studio fornece o JDK compatível e permite testar diretamente em aparelho físico. O artefato de depuração será gerado em `android/app/build/outputs/apk/debug/`.

Nesta primeira base, o app já é empacotável. Alarmes, vibração e áudio realmente confiável em segundo plano serão implementados na camada Android nas próximas etapas.

## Regras de domínio iniciais

- Metas permitidas: 100 a 500, em incrementos de 50.
- Tempo é armazenado em segundos, apresentado em `mm:ss`.
- Sets são opcionais; se existirem, a soma deve corresponder à meta.
- Estatísticas e PRs são derivados dos treinos, nunca gravados como uma segunda fonte de verdade.

Consulte a [arquitetura inicial](docs/architecture.md) e o [roadmap](docs/roadmap.md) para os próximos componentes.
