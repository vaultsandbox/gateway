import { Component, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import {
  FilterConfig,
  FilterRule,
  FILTER_FIELD_OPTIONS,
  FILTER_OPERATOR_OPTIONS,
  FILTER_MODE_OPTIONS,
} from '../../interfaces/webhook.interfaces';

@Component({
  selector: 'app-webhook-filter-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SelectModule,
    InputTextModule,
    ButtonModule,
    SelectButtonModule,
    CheckboxModule,
    TooltipModule,
  ],
  templateUrl: './webhook-filter-form.html',
})
export class WebhookFilterForm {
  filter = model.required<FilterConfig>();

  readonly fieldOptions = FILTER_FIELD_OPTIONS;
  readonly operatorOptions = FILTER_OPERATOR_OPTIONS;
  readonly modeOptions = FILTER_MODE_OPTIONS;

  addRule(): void {
    const currentFilter = this.filter();
    if (currentFilter.rules.length >= 10) {
      return;
    }

    this.filter.set({
      ...currentFilter,
      rules: [
        ...currentFilter.rules,
        {
          field: 'subject',
          operator: 'contains',
          value: '',
        },
      ],
    });
  }

  removeRule(index: number): void {
    const currentFilter = this.filter();
    this.filter.set({
      ...currentFilter,
      rules: currentFilter.rules.filter((_, i) => i !== index),
    });
  }

  updateRule(index: number, updates: Partial<FilterRule>): void {
    const currentFilter = this.filter();
    const newRules = [...currentFilter.rules];
    newRules[index] = { ...newRules[index], ...updates };
    this.filter.set({
      ...currentFilter,
      rules: newRules,
    });
  }

  updateMode(mode: 'all' | 'any'): void {
    const currentFilter = this.filter();
    this.filter.set({
      ...currentFilter,
      mode,
    });
  }

  updateRequireAuth(requireAuth: boolean): void {
    const currentFilter = this.filter();
    this.filter.set({
      ...currentFilter,
      requireAuth,
    });
  }

  trackByIndex(index: number): number {
    return index;
  }
}
