# Próximas prioridades

1. [x] Filtro por quantidade de NSBs nas análises visuais.
2. [x] Comparação anual mês a mês: pontos coloridos por ano, com linhas discretas conectando os meses de cada série.
3. [x] Heatmap de consistência diária.
4. [x] Estatísticas de tempo: mínimo, máximo, média, mediana e tempo médio por repetição para cada quantidade.
5. [x] Estratégias de sets: comparar tempo e ritmo de estruturas como `2 × 50` e `5 × 20`.
6. **Plano de pacing guiado:** o usuário define meta, estrutura de sets, tempo-alvo por set e descanso. Durante o treino, o app acompanha o estado `pronto → set → descanso → próximo set`, mostra o contador/cronômetro e dispara alertas sonoros locais no início do set, fim do set e fim do descanso. O plano permite pausar, retomar, pular fase e salvar os tempos efetivos de cada bloco. Áudio deve ser ativado por uma ação explícita do usuário; vibração será uma melhoria opcional e compatível com o aparelho.
7. [x] Perfis de alertas sonoros do pacing: seleção local de conjuntos distintos; vibração compatível com o aparelho permanece como evolução futura.
8. Configuração de treinos padrão: uma interface visual para editar a matriz de quantidades e, opcionalmente, permitir entradas livres, sem comprometer os atalhos iniciais de 100 a 500 em incrementos de 50. Incluir presets reutilizáveis de quantidade, estrutura de sets, pacing e descansos para iniciar uma sessão já configurada.
9. [x] Sessão ativa persistente: salvar e restaurar localmente o registro, cronômetro e estado de pacing em andamento.
10. [x] Estatísticas de pacing: integrar o ritmo de execução dos treinos guiados ao cartão de cada quantidade.
11. [x] Ritmo e descanso por grupo de sets: valores gerais com ajustes opcionais por grupo e fotografia do plano no treino salvo.
12. [x] Meta total de sessão: calcular ritmo-base e duração dos blocos a partir do tempo total desejado, descansos e ajustes por grupo; indicar projeção em modos de descanso manual.
13. [~] Camada móvel: Wake Lock e sessão de áudio persistente foram iniciados no web app. Alarmes/áudio confiáveis em segundo plano e notificações locais exigem uma etapa nativa dedicada.
14. [x] Temas e cores: modo claro, escuro ou automático, paletas de acento independentes e opção de aplicá-las (ou não) nos gráficos e calendário, com preferência salva localmente.
15. Baixa prioridade — Idioma geral do aplicativo: tela de configurações para alternar entre português, inglês e espanhol, com preferência salva localmente.
