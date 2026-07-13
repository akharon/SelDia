// =============================================================================
// SelDiA — LSP Go-to-Definition Provider
// =============================================================================
// Allows jumping from a node ID reference (e.g. in an edge declaration)
// to its declaration line. Supports:
//   - Edge targets: "node1 --> node2" → jump to node2's declaration
//   - Any node ID reference → jump to declaration

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';

export class SelDiADefinitionProvider implements vscode.DefinitionProvider {
  private engine: CoreEngine;

  constructor(engine: CoreEngine) {
    this.engine = engine;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | null> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (!word) return null;

    // Find the declaration of this node ID
    const declLocation = this.findDeclaration(document, word);
    if (declLocation) {
      return declLocation;
    }

    return null;
  }

  /**
   * Search the document for a node/entity/participant/class declaration.
   */
  private findDeclaration(
    document: vscode.TextDocument,
    id: string
  ): vscode.Location | null {
    const text = document.getText();
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match patterns:
    //   myNode: (Shape) "Label"
    //   participant myNode: "Label"
    //   entity MyEntity { ... }
    //   class MyClass { ... }
    const patterns = [
      new RegExp(`^[\\s]*${escapedId}\\s*:`, 'm'),
      new RegExp(`^[\\s]*participant\\s+${escapedId}\\s*:`, 'm'),
      new RegExp(`^[\\s]*entity\\s+${escapedId}\\b`, 'm'),
      new RegExp(`^[\\s]*class\\s+${escapedId}\\b`, 'm'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && typeof match.index === 'number') {
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        return new vscode.Location(document.uri, new vscode.Range(startPos, endPos));
      }
    }

    return null;
  }
}
