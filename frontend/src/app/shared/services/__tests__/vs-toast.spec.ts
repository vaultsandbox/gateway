import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MessageService } from 'primeng/api';
import { VsToast } from '../vs-toast';

describe('VsToast', () => {
  let service: VsToast;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), MessageService],
    });
    service = TestBed.inject(VsToast);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
