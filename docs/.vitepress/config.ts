import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SelDiA',
  description: 'Self-Diagramming Architecture — Unified Diagram-as-Code with Rough.js',
  lang: 'en-US',
  lastUpdated: true,
  themeConfig: {
    logo: '/icon.svg',
    siteTitle: 'SelDiA',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Diagrams', link: '/diagrams/overview' },
      { text: 'Reference', link: '/reference/dsl-syntax' },
      { text: 'Architecture', link: '/arch' },
      { text: 'Plan', link: '/plan' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Writing DSL', link: '/guide/writing-dsl' },
            { text: 'CLI Usage', link: '/guide/cli-usage' },
            { text: 'VS Code Extension', link: '/guide/vscode-extension' },
            { text: 'Web Components', link: '/guide/web-components' },
            { text: 'Export & PDF', link: '/guide/export-pdf' },
          ],
        },
      ],
      '/diagrams/': [
        {
          text: 'Diagram Types',
          items: [
            { text: 'Overview', link: '/diagrams/overview' },
            { text: 'Flowchart', link: '/diagrams/flowchart' },
            { text: 'Sequence', link: '/diagrams/sequence' },
            { text: 'Class', link: '/diagrams/class' },
            { text: 'C4 Context', link: '/diagrams/c4-context' },
            { text: 'C4 Container', link: '/diagrams/c4-container' },
            { text: 'State', link: '/diagrams/state' },
            { text: 'Entity Relationship', link: '/diagrams/er' },
            { text: 'BPMN', link: '/diagrams/bpmn' },
            { text: 'Gantt', link: '/diagrams/gantt' },
            { text: 'Mind Map', link: '/diagrams/mindmap' },
            { text: 'Bar Chart', link: '/diagrams/chart-bar' },
            { text: 'Network', link: '/diagrams/network' },
            { text: 'Component', link: '/diagrams/component' },
            { text: 'Use Case', link: '/diagrams/usecase' },
            { text: 'DMN', link: '/diagrams/dmn' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'DSL Syntax', link: '/reference/dsl-syntax' },
            { text: 'Node Shapes', link: '/reference/node-shapes' },
            { text: 'Edge Types', link: '/reference/edge-types' },
            { text: 'Themes & Styling', link: '/reference/themes' },
            { text: 'Layout Engine', link: '/reference/layout' },
            { text: 'Plugin Development', link: '/reference/plugin-dev' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mkyr/seldia' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 SelDiA',
    },
  },
});
