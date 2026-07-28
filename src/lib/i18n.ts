export type AppLanguage = 'pt-BR' | 'en-US' | 'es-ES'

const messages: Record<AppLanguage, Record<string, string>> = {
  'pt-BR': {
    'language.title': 'Idioma', 'language.pt': 'Português', 'language.en': 'English', 'language.es': 'Español',
    'nav.home': 'Início', 'nav.workouts': 'Treinos', 'nav.data': 'Dados', 'nav.settings': 'Ajustes', 'nav.label': 'Navegação principal',
    'home.register': 'Registrar treino', 'home.period': 'Período do resumo', 'home.filter': 'Filtrar quantidade de NSBs', 'home.all': 'Todos', 'home.expand': 'Mostrar quantidades', 'home.collapse': 'Recolher quantidades', 'home.analysis': 'Modo de análise', 'home.compare': 'Comparar anos', 'home.evolution': 'Evolução', 'home.statistics': 'Estatísticas',
    'period.all': 'Todo o período', 'period.year': 'Este ano', 'period.month': 'Este mês',
    'history.eyebrow': 'Registros detalhados', 'history.title': 'Treinos', 'history.lead': 'Consulte, ajuste ou mova registros detalhados para a lixeira. As análises ficam concentradas na tela inicial.', 'history.loading': 'Carregando dados locais…',
    'data.eyebrow': 'Propriedade dos dados', 'data.title': 'Backup e restauração', 'data.lead': 'Exporte uma cópia completa do seu histórico. Uma importação segura combina registros pelo identificador e mantém a versão mais recente.', 'data.export': 'Exportar backup JSON', 'data.import': 'Importar backup', 'data.restore': 'Restaurar backup', 'data.summary': 'Importar combina registros. Restaurar substitui treinos, históricos e preferências após criar uma cópia de segurança.',
    'settings.eyebrow': 'Ajustes', 'settings.title': 'Preferências', 'settings.appearance': 'Aparência', 'settings.system': 'Automático', 'settings.light': 'Claro', 'settings.dark': 'Escuro',
  },
  'en-US': {
    'language.title': 'Language', 'language.pt': 'Português', 'language.en': 'English', 'language.es': 'Español',
    'nav.home': 'Home', 'nav.workouts': 'Workouts', 'nav.data': 'Data', 'nav.settings': 'Settings', 'nav.label': 'Main navigation',
    'home.register': 'Log workout', 'home.period': 'Summary period', 'home.filter': 'Filter NSB count', 'home.all': 'All', 'home.expand': 'Show targets', 'home.collapse': 'Hide targets', 'home.analysis': 'Analysis mode', 'home.compare': 'Compare years', 'home.evolution': 'Progress', 'home.statistics': 'Statistics',
    'period.all': 'All time', 'period.year': 'This year', 'period.month': 'This month',
    'history.eyebrow': 'Detailed records', 'history.title': 'Workouts', 'history.lead': 'Review, edit, or move detailed records to the bin. Analysis stays on the home screen.', 'history.loading': 'Loading local data…',
    'data.eyebrow': 'Data ownership', 'data.title': 'Backup and restore', 'data.lead': 'Export a complete copy of your history. A safe import merges records by identifier and keeps the latest version.', 'data.export': 'Export JSON backup', 'data.import': 'Import backup', 'data.restore': 'Restore backup', 'data.summary': 'Import merges records. Restore replaces workouts, history, and preferences after creating a safety copy.',
    'settings.eyebrow': 'Settings', 'settings.title': 'Preferences', 'settings.appearance': 'Appearance', 'settings.system': 'System', 'settings.light': 'Light', 'settings.dark': 'Dark',
  },
  'es-ES': {
    'language.title': 'Idioma', 'language.pt': 'Português', 'language.en': 'English', 'language.es': 'Español',
    'nav.home': 'Inicio', 'nav.workouts': 'Entrenamientos', 'nav.data': 'Datos', 'nav.settings': 'Ajustes', 'nav.label': 'Navegación principal',
    'home.register': 'Registrar entrenamiento', 'home.period': 'Período del resumen', 'home.filter': 'Filtrar cantidad de NSB', 'home.all': 'Todos', 'home.expand': 'Mostrar cantidades', 'home.collapse': 'Ocultar cantidades', 'home.analysis': 'Modo de análisis', 'home.compare': 'Comparar años', 'home.evolution': 'Evolución', 'home.statistics': 'Estadísticas',
    'period.all': 'Todo el período', 'period.year': 'Este año', 'period.month': 'Este mes',
    'history.eyebrow': 'Registros detallados', 'history.title': 'Entrenamientos', 'history.lead': 'Consulta, ajusta o mueve registros detallados a la papelera. El análisis permanece en la pantalla inicial.', 'history.loading': 'Cargando datos locales…',
    'data.eyebrow': 'Propiedad de datos', 'data.title': 'Copia de seguridad y restauración', 'data.lead': 'Exporta una copia completa de tu historial. Una importación segura combina registros por identificador y conserva la versión más reciente.', 'data.export': 'Exportar copia JSON', 'data.import': 'Importar copia', 'data.restore': 'Restaurar copia', 'data.summary': 'Importar combina registros. Restaurar reemplaza entrenamientos, historial y preferencias tras crear una copia de seguridad.',
    'settings.eyebrow': 'Ajustes', 'settings.title': 'Preferencias', 'settings.appearance': 'Apariencia', 'settings.system': 'Automático', 'settings.light': 'Claro', 'settings.dark': 'Oscuro',
  },
}

export function translate(language: AppLanguage, key: string): string {
  return messages[language][key] ?? messages['pt-BR'][key] ?? key
}
