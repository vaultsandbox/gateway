import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { ParsedEmailContent } from '../../interfaces';

@Component({
  selector: 'app-email-auth-results',
  standalone: true,
  imports: [CommonModule, CardModule, BadgeModule],
  templateUrl: './email-auth-results.html',
  styleUrl: './email-auth-results.scss',
})
export class EmailAuthResultsComponent {
  @Input() authResults?: ParsedEmailContent['authResults'];

  /**
   * Returns badge styling classes based on the authentication result string.
   */
  getResultClass(result: string): string {
    switch (result.toLowerCase()) {
      case 'pass':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'fail':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'softfail':
      case 'neutral':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'none':
      default:
        return 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-300';
    }
  }
}
