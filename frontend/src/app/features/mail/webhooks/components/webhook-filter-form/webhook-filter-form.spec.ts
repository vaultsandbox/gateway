import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ComponentRef } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { WebhookFilterForm } from './webhook-filter-form';
import { FilterConfig } from '../../interfaces/webhook.interfaces';

describe('WebhookFilterForm', () => {
  let component: WebhookFilterForm;
  let componentRef: ComponentRef<WebhookFilterForm>;
  let fixture: ComponentFixture<WebhookFilterForm>;

  const createEmptyFilter = (): FilterConfig => ({
    rules: [],
    mode: 'all',
  });

  const createFilterWithRules = (ruleCount = 1): FilterConfig => ({
    rules: Array.from({ length: ruleCount }, (_, i) => ({
      field: 'subject',
      operator: 'contains',
      value: `test-${i}`,
    })),
    mode: 'all',
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WebhookFilterForm],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(WebhookFilterForm);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
  });

  it('should create', () => {
    componentRef.setInput('filter', createEmptyFilter());
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('fieldOptions', () => {
    beforeEach(() => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();
    });

    it('contains expected field options', () => {
      expect(component.fieldOptions.length).toBeGreaterThan(0);
      expect(component.fieldOptions.find((f) => f.value === 'subject')).toBeDefined();
      expect(component.fieldOptions.find((f) => f.value === 'from.address')).toBeDefined();
    });
  });

  describe('operatorOptions', () => {
    beforeEach(() => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();
    });

    it('contains expected operator options', () => {
      expect(component.operatorOptions.length).toBeGreaterThan(0);
      expect(component.operatorOptions.find((o) => o.value === 'contains')).toBeDefined();
      expect(component.operatorOptions.find((o) => o.value === 'equals')).toBeDefined();
      expect(component.operatorOptions.find((o) => o.value === 'regex')).toBeDefined();
    });
  });

  describe('modeOptions', () => {
    beforeEach(() => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();
    });

    it('contains all and any mode options', () => {
      expect(component.modeOptions.length).toBe(2);
      expect(component.modeOptions.find((m) => m.value === 'all')).toBeDefined();
      expect(component.modeOptions.find((m) => m.value === 'any')).toBeDefined();
    });
  });

  describe('addRule', () => {
    it('adds a new rule with default values', () => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();

      component.addRule();

      const filter = component.filter();
      expect(filter.rules.length).toBe(1);
      expect(filter.rules[0]).toEqual({
        field: 'subject',
        operator: 'contains',
        value: '',
      });
    });

    it('appends rule to existing rules', () => {
      componentRef.setInput('filter', createFilterWithRules(2));
      fixture.detectChanges();

      component.addRule();

      expect(component.filter().rules.length).toBe(3);
    });

    it('does not add more than 10 rules', () => {
      componentRef.setInput('filter', createFilterWithRules(10));
      fixture.detectChanges();

      component.addRule();

      expect(component.filter().rules.length).toBe(10);
    });
  });

  describe('removeRule', () => {
    it('removes rule at specified index', () => {
      const filter = createFilterWithRules(3);
      filter.rules[1].value = 'middle-rule';
      componentRef.setInput('filter', filter);
      fixture.detectChanges();

      component.removeRule(1);

      const updatedFilter = component.filter();
      expect(updatedFilter.rules.length).toBe(2);
      expect(updatedFilter.rules.find((r) => r.value === 'middle-rule')).toBeUndefined();
    });

    it('preserves other rules', () => {
      const filter = createFilterWithRules(3);
      componentRef.setInput('filter', filter);
      fixture.detectChanges();

      component.removeRule(0);

      expect(component.filter().rules[0].value).toBe('test-1');
      expect(component.filter().rules[1].value).toBe('test-2');
    });
  });

  describe('updateRule', () => {
    beforeEach(() => {
      componentRef.setInput('filter', createFilterWithRules(2));
      fixture.detectChanges();
    });

    it('updates field property', () => {
      component.updateRule(0, { field: 'from.address' });

      expect(component.filter().rules[0].field).toBe('from.address');
    });

    it('updates operator property', () => {
      component.updateRule(0, { operator: 'equals' });

      expect(component.filter().rules[0].operator).toBe('equals');
    });

    it('updates value property', () => {
      component.updateRule(0, { value: 'new-value' });

      expect(component.filter().rules[0].value).toBe('new-value');
    });

    it('updates multiple properties at once', () => {
      component.updateRule(0, {
        field: 'body.text',
        operator: 'regex',
        value: '.*pattern.*',
      });

      const rule = component.filter().rules[0];
      expect(rule.field).toBe('body.text');
      expect(rule.operator).toBe('regex');
      expect(rule.value).toBe('.*pattern.*');
    });

    it('preserves other rules when updating', () => {
      component.updateRule(0, { value: 'updated' });

      expect(component.filter().rules[1].value).toBe('test-1');
    });
  });

  describe('updateMode', () => {
    it('changes mode to any', () => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();

      component.updateMode('any');

      expect(component.filter().mode).toBe('any');
    });

    it('changes mode to all', () => {
      const filter = createEmptyFilter();
      filter.mode = 'any';
      componentRef.setInput('filter', filter);
      fixture.detectChanges();

      component.updateMode('all');

      expect(component.filter().mode).toBe('all');
    });

    it('preserves rules when updating mode', () => {
      componentRef.setInput('filter', createFilterWithRules(2));
      fixture.detectChanges();

      component.updateMode('any');

      expect(component.filter().rules.length).toBe(2);
    });
  });

  describe('updateRequireAuth', () => {
    it('sets requireAuth to true', () => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();

      component.updateRequireAuth(true);

      expect(component.filter().requireAuth).toBeTrue();
    });

    it('sets requireAuth to false', () => {
      const filter = createEmptyFilter();
      filter.requireAuth = true;
      componentRef.setInput('filter', filter);
      fixture.detectChanges();

      component.updateRequireAuth(false);

      expect(component.filter().requireAuth).toBeFalse();
    });

    it('preserves other filter properties', () => {
      componentRef.setInput('filter', createFilterWithRules(2));
      fixture.detectChanges();

      component.updateRequireAuth(true);

      expect(component.filter().rules.length).toBe(2);
      expect(component.filter().mode).toBe('all');
    });
  });

  describe('trackByIndex', () => {
    beforeEach(() => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();
    });

    it('returns the index', () => {
      expect(component.trackByIndex(0)).toBe(0);
      expect(component.trackByIndex(5)).toBe(5);
      expect(component.trackByIndex(99)).toBe(99);
    });
  });

  describe('two-way binding via model', () => {
    it('updates filter through model signal', () => {
      componentRef.setInput('filter', createEmptyFilter());
      fixture.detectChanges();

      const newFilter: FilterConfig = {
        rules: [{ field: 'subject', operator: 'equals', value: 'test' }],
        mode: 'any',
        requireAuth: true,
      };

      component.filter.set(newFilter);

      expect(component.filter()).toEqual(newFilter);
    });
  });
});
