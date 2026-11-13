import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SelDiA',
  description: 'The diagram engine — keep your Mermaid, PlantUML, or SelDiA DSL; SelDiA keeps it true.',
  lang: 'en-US',
  lastUpdated: true,
  // The user guide is the site home page.
  rewrites: {
    'user_guide.md': 'index.md',
  },
  themeConfig: {
    siteTitle: 'SelDiA',
    nav: [
      { text: 'Guide', link: '/' },
      { text: 'Architecture', link: '/arch' },
      { text: 'Reference', link: '/reference' },
      { text: 'Roadmap', link: '/roadmap' },
    ],
    sidebar: [
      {
        text: 'Docs',
        items: [
          { text: 'User Guide', link: '/' },
          { text: 'Architecture', link: '/arch' },
          { text: 'Reference', link: '/reference' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mkyr/seldia' },
    ],
    footer: {
      message: 'Released under AGPL-3.0-or-later or a commercial license.',
      copyright: 'Copyright © SelDiA',
    },
  },
});
