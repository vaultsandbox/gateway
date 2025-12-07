export interface LinkValidationStatus {
  url: string;
  status: 'unchecked' | 'checking' | 'valid' | 'invalid' | 'error';
  statusCode?: number;
  error?: string;
}

export class EmailLinksHelpers {
  /**
   * Chooses an icon class based on URL scheme.
   */
  static getLinkIcon(url: string): string {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.startsWith('mailto:')) {
      return 'pi pi-envelope text-blue-500';
    }

    if (lowerUrl.startsWith('https://')) {
      return 'pi pi-lock text-green-500';
    }

    if (lowerUrl.startsWith('http://')) {
      return 'pi pi-globe text-orange-500';
    }

    if (lowerUrl.startsWith('ftp://')) {
      return 'pi pi-server text-purple-500';
    }

    return 'pi pi-link text-surface-500';
  }

  /**
   * Returns a short label representing the URL scheme.
   */
  static getLinkType(url: string): string {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.startsWith('mailto:')) {
      return 'Email';
    }

    if (lowerUrl.startsWith('https://')) {
      return 'HTTPS';
    }

    if (lowerUrl.startsWith('http://')) {
      return 'HTTP';
    }

    if (lowerUrl.startsWith('ftp://')) {
      return 'FTP';
    }

    return 'Link';
  }

  /**
   * Returns badge styling classes for a link validation status.
   */
  static getStatusBadgeClass(status: LinkValidationStatus['status']): string {
    const baseClasses = 'px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap';

    switch (status) {
      case 'checking':
        return `${baseClasses} bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200`;
      case 'valid':
        return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`;
      case 'invalid':
      case 'error':
        return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`;
      default:
        return `${baseClasses} bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-200`;
    }
  }

  /**
   * Returns a status icon class for the given validation status.
   */
  static getStatusIcon(status: LinkValidationStatus['status']): string {
    switch (status) {
      case 'checking':
        return 'pi pi-spinner pi-spin';
      case 'valid':
        return 'pi pi-check-circle';
      case 'invalid':
      case 'error':
        return 'pi pi-times-circle';
      default:
        return 'pi pi-question-circle';
    }
  }

  /**
   * Returns a human-friendly label for a validation status.
   */
  static getStatusLabel(status: LinkValidationStatus['status']): string {
    switch (status) {
      case 'checking':
        return 'Checking...';
      case 'valid':
        return 'Valid';
      case 'invalid':
        return 'Invalid';
      case 'error':
        return 'Error';
      default:
        return 'Unchecked';
    }
  }

  /**
   * Builds a tooltip string for a link validation entry.
   */
  static getStatusTooltip(linkStatus: LinkValidationStatus): string {
    if (linkStatus.error) {
      return linkStatus.error;
    }

    if (linkStatus.statusCode) {
      return `HTTP ${linkStatus.statusCode}`;
    }

    return EmailLinksHelpers.getStatusLabel(linkStatus.status);
  }

  /**
   * Truncates a URL with ellipsis when it exceeds the desired length.
   */
  static truncateUrl(url: string, maxLength: number): string {
    if (url.length <= maxLength) {
      return url;
    }

    return url.substring(0, maxLength - 3) + '...';
  }
}
