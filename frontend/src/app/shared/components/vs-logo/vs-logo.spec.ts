import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { VsLogo } from './vs-logo';

describe('VsLogo', () => {
  let component: VsLogo;
  let fixture: ComponentFixture<VsLogo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VsLogo],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(VsLogo);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
