import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmailAuthResultsComponent } from './email-auth-results';

describe('EmailAuthResultsComponent', () => {
  let component: EmailAuthResultsComponent;
  let fixture: ComponentFixture<EmailAuthResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailAuthResultsComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailAuthResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('getResultClass', () => {
    it('returns green classes for "pass"', () => {
      expect(component.getResultClass('pass')).toBe(
        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      );
    });

    it('returns green classes for "PASS" (case-insensitive)', () => {
      expect(component.getResultClass('PASS')).toBe(
        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      );
    });

    it('returns red classes for "fail"', () => {
      expect(component.getResultClass('fail')).toBe('bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200');
    });

    it('returns red classes for "FAIL" (case-insensitive)', () => {
      expect(component.getResultClass('FAIL')).toBe('bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200');
    });

    it('returns yellow classes for "softfail"', () => {
      expect(component.getResultClass('softfail')).toBe(
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      );
    });

    it('returns yellow classes for "neutral"', () => {
      expect(component.getResultClass('neutral')).toBe(
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      );
    });

    it('returns gray classes for "skipped"', () => {
      expect(component.getResultClass('skipped')).toBe(
        'bg-surface-300 text-surface-600 dark:bg-surface-600 dark:text-surface-300',
      );
    });

    it('returns surface classes for "none"', () => {
      expect(component.getResultClass('none')).toBe(
        'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-300',
      );
    });

    it('returns surface classes for unknown values (default case)', () => {
      expect(component.getResultClass('unknown')).toBe(
        'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-300',
      );
    });
  });
});
