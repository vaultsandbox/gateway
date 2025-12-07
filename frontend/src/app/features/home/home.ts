import { Component, inject } from '@angular/core';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { NoApiKey } from '../no-api-key/no-api-key';
import { Mail } from '../mail/mail';

@Component({
  selector: 'app-home',
  imports: [NoApiKey, Mail],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  standalone: true,
})
export class Home {
  protected readonly vaultSandbox = inject(VaultSandbox);
}
