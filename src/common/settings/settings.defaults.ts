import type { AppDownload, PluginInfo, TutorialContent } from '../../contracts';

/**
 * Valores da tabela `Setting` quando a chave não existe. O seed grava os
 * mesmos valores, e a administração pode trocá-los no banco sem novo deploy.
 */

/** Faixas de tier, da mais alta para a mais baixa; quem não cabe em nenhuma é NOVATO. */
export interface TierRule {
  tier: string;
  minLevel: number;
  minRating: number;
}

export const DEFAULT_TIER_RULES: TierRule[] = [
  { tier: 'ELITE', minLevel: 10, minRating: 8.5 },
  { tier: 'VETERANO', minLevel: 5, minRating: 7 },
];

export const DEFAULT_TIER = 'NOVATO';

/** Os tiers que a regra recalcula. Os outros (QA) são dados à mão e não mudam. */
export const AUTOMATIC_TIERS = [DEFAULT_TIER, ...DEFAULT_TIER_RULES.map((regra) => regra.tier)];

/** Tela de conclusão (Figma `287:5085`): "Bônus por feedback completo: +R$ 0,05". */
export interface RewardBonuses {
  completeFeedbackCents: number;
  bugReportedCents: number;
}

export const DEFAULT_REWARD_BONUSES: RewardBonuses = { completeFeedbackCents: 5, bugReportedCents: 5 };

/** "XP base: 50", "Bônus por feedback completo: +5", "Bônus por bug reportado: +5". */
export interface XpRules {
  base: number;
  completeFeedback: number;
  bugReported: number;
}

export const DEFAULT_XP_RULES: XpRules = { base: 50, completeFeedback: 5, bugReported: 5 };

/** Os links são relativos a VITE_API_URL até existir um site do plug-in. */
export const DEFAULT_PLUGIN_INFO: PluginInfo = {
  sdkVersion: '1.0.0',
  downloadUrl: '/files/downloads/OrbitPlugin-Unity-1.0.0.unitypackage',
  docsUrl: '/files/docs/orbitplug-in.html',
  siteUrl: '/files/docs/orbitplug-in.html',
  engines: ['Unity'],
};

/** "Instale o OrbitPlay / Também disponível para:" (Figma `181:605`). A versão é a da barra de título. */
export const DEFAULT_APP_DOWNLOADS: AppDownload[] = [
  { platform: 'PC', label: 'Windows', url: '/files/downloads/OrbitPlay-Setup-1.0.0.2.exe', version: '1.0.0.2' },
  { platform: 'MAC', label: 'macOS', url: '/files/downloads/OrbitPlay-1.0.0.2.dmg', version: '1.0.0.2' },
  { platform: 'LINUX', label: 'Linux', url: '/files/downloads/OrbitPlay-1.0.0.2.AppImage', version: '1.0.0.2' },
];

/** Os textos dos frames de tutorial (`224:7273`, `224:7334`, `224:7409`, `224:7481`). */
export const DEFAULT_TUTORIAL: TutorialContent = {
  title: 'Tutorial: Teste demo livre',
  intro:
    'Enquanto a build do jogo está baixando, você vai passar por um breve tutorial. Assim, aprende como testar da melhor forma e ganhar mais pontos de feedback!',
  video: {
    title: 'Saiba como fazer um bom playtest de um jogo!',
    description:
      'Neste video, Cláudio Gusmão da UX4INDIE mostra como dar um feedback eficaz após realizar o playtest de um game.',
    url: '',
  },
  observe: {
    title: 'O que observar?',
    items: [
      {
        title: 'Bugs & travamentos',
        text: 'O jogo travou, fechou sozinho ou congelou? Personagens, carros ou objetos ficaram presos ou sumiram? Alguma ação não funcionou como deveria? Diga o que aconteceu e em que momento.',
      },
      {
        title: 'Dificuldade da fase',
        text: 'A fase está fácil demais ou difícil demais? Ficou claro o que você precisava fazer? Algum trecho parece injusto ou frustrante? Conte como você se sentiu jogando.',
      },
      {
        title: 'Áudio / narrativa',
        text: 'Sons e músicas combinam com o jogo? O áudio está claro ou atrapalha a jogabilidade? A narrativa faz sentido e ajuda na imersão? Destaque se algo ajudou ou atrapalhou sua experiência.',
      },
      {
        title: 'Gráficos / interface',
        text: 'Os gráficos estão bonitos e consistentes? A interface é clara e fácil de entender? Botões, textos e ícones estão visíveis durante a ação? Aponte o que está confuso, bonito ou poderia melhorar.',
      },
    ],
  },
  tips: {
    title: 'Dicas para o formulário',
    items: [
      {
        title: 'Seja específico',
        text: 'Em vez de “não gostei do inimigo”, escreva “o inimigo na fase 2 demora muito para reagir e isso deixou a luta cansativa”.',
      },
      {
        title: 'Equilibre crítica e elogio',
        text: '“Gostei da arte do cenário, mas achei que os sons estavam baixos demais.”',
      },
      {
        title: 'Descreva o contexto',
        text: 'Exemplo: “O bug aconteceu quando eu pulei pela segunda vez na plataforma depois de derrotar o chefe.”',
      },
      {
        title: 'Pense como jogador e como estúdio',
        text: 'Imagine que seu feedback será usado pela equipe de desenvolvimento para ajustar o game. Quanto mais claro, mais útil!',
      },
    ],
  },
  ready: {
    title: 'Tudo pronto!',
    text: 'Assim que a build estiver pronta voce poderá começar o seu teste, divirta-se!',
    warning: 'Lembrando que a recompensa só será enviada após o feedback, Se fechar sem enviar feedback, não conta.',
  },
};
