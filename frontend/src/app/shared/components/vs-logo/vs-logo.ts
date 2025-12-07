import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-vs-logo',
  imports: [],
  templateUrl: './vs-logo.html',
  styleUrl: './vs-logo.scss',
  standalone: true,
})
export class VsLogo {
  /**
   * Controls which SVG to render. Defaults to the original vertical layout.
   */
  @Input() orientation: 'vertical' | 'horizontal' = 'vertical';
}
