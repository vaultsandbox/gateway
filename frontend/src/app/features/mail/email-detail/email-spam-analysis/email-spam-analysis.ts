import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { SpamAnalysisResult, SpamSymbol } from '../../interfaces';

@Component({
  selector: 'app-email-spam-analysis',
  standalone: true,
  imports: [CommonModule, CardModule],
  templateUrl: './email-spam-analysis.html',
  styleUrl: './email-spam-analysis.scss',
})
export class EmailSpamAnalysisComponent {
  @Input() spamAnalysis?: SpamAnalysisResult;

  /** Expose Math for template use */
  protected readonly Math = Math;

  /**
   * Returns badge styling classes based on action severity.
   */
  getActionClass(action?: string): string {
    switch (action) {
      case 'no action':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'greylist':
      case 'add header':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'rewrite subject':
      case 'soft reject':
      case 'reject':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-300';
    }
  }

  /**
   * Returns styling classes for the overall score display.
   */
  getScoreClass(score?: number, requiredScore?: number): string {
    if (score === undefined) {
      return 'text-surface-500';
    }
    const threshold = requiredScore ?? 6.0;

    if (score < 0) {
      return 'text-green-600 dark:text-green-400';
    } else if (score < 3) {
      return 'text-green-500 dark:text-green-400';
    } else if (score < threshold) {
      return 'text-yellow-600 dark:text-yellow-400';
    } else if (score < 10) {
      return 'text-red-600 dark:text-red-400';
    } else {
      return 'text-red-700 dark:text-red-300 font-bold';
    }
  }

  /**
   * Returns a human-readable verdict based on the score and spam status.
   */
  getVerdict(): { text: string; class: string } {
    if (!this.spamAnalysis || this.spamAnalysis.status !== 'analyzed') {
      return { text: 'Unknown', class: 'text-surface-500' };
    }

    if (this.spamAnalysis.isSpam) {
      return { text: 'Spam', class: 'text-red-600 dark:text-red-400' };
    }

    const score = this.spamAnalysis.score ?? 0;
    if (score < 0) {
      return { text: 'Clean', class: 'text-green-600 dark:text-green-400' };
    } else if (score < 3) {
      return { text: 'Likely Clean', class: 'text-green-500 dark:text-green-400' };
    } else {
      return { text: 'Suspicious', class: 'text-yellow-600 dark:text-yellow-400' };
    }
  }

  /**
   * Categorizes symbols into positive (spam indicators), negative (ham indicators), and neutral.
   */
  categorizeSymbols(): { positive: SpamSymbol[]; negative: SpamSymbol[]; neutral: SpamSymbol[] } {
    const symbols = this.spamAnalysis?.symbols ?? [];
    return {
      positive: symbols.filter((s) => s.score > 0).sort((a, b) => b.score - a.score),
      negative: symbols.filter((s) => s.score < 0).sort((a, b) => a.score - b.score),
      neutral: symbols.filter((s) => s.score === 0),
    };
  }

  /**
   * Returns styling classes for individual symbol scores.
   */
  getSymbolScoreClass(score: number): string {
    if (score > 0) {
      return 'text-red-600 dark:text-red-400';
    } else if (score < 0) {
      return 'text-green-600 dark:text-green-400';
    }
    return 'text-surface-500';
  }

  /**
   * Formats score with sign prefix.
   */
  formatScore(score: number): string {
    return score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  }

  /**
   * Formats action name for display.
   */
  formatAction(action?: string): string {
    if (!action) return 'Unknown';
    return action
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
