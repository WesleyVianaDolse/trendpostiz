/** @jest-environment jsdom */

jest.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    withProvider: (options: any) => options.SettingsComponent,
    PostComment: { COMMENT: 'comment' },
  })
);
jest.mock('@gitroom/react/form/input', () => ({ Input: () => null }));
jest.mock('@gitroom/react/translation/translated-label', () => ({
  TranslatedLabel: ({ label }: any) => <>{label}</>,
}));
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/medium/medium.tags',
  () => ({ MediumTags: () => null })
);
jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaComponent: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview',
  () => ({ YoutubePreview: () => null })
);

import 'reflect-metadata';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { getDefaultProviderSettings } from '@gitroom/frontend/features/publisher/model/provider-rules';
import YoutubeSettings from './youtube.provider';

const submit = jest.fn();

function Form({ audience }: { audience?: 'yes' | 'no' }) {
  const form = useForm({
    resolver: classValidatorResolver(YoutubeSettingsDto),
    defaultValues: {
      title: 'Video title',
      type: 'private',
      ...(audience === undefined ? {} : { selfDeclaredMadeForKids: audience }),
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <YoutubeSettings />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

describe('YouTube audience selection', () => {
  beforeEach(() => submit.mockClear());

  it('does not declare an audience in Publisher defaults', () => {
    expect(getDefaultProviderSettings('youtube')).not.toHaveProperty(
      'selfDeclaredMadeForKids'
    );
  });

  it('starts with the channel setting and submits no audience declaration', async () => {
    render(<Form />);
    expect(
      (screen.getAllByRole('combobox')[1] as HTMLSelectElement).value
    ).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].selfDeclaredMadeForKids).toBeUndefined();
  });

  it.each(['yes', 'no'] as const)(
    'preserves an existing explicit %s',
    async (audience) => {
      render(<Form audience={audience} />);
      expect(
        (screen.getAllByRole('combobox')[1] as HTMLSelectElement).value
      ).toBe(audience);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit.mock.calls[0][0].selfDeclaredMadeForKids).toBe(audience);
    }
  );

  it('lets the user choose no and then return to the channel setting', async () => {
    render(<Form />);
    const audience = screen.getAllByRole('combobox')[1];
    fireEvent.change(audience, { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].selfDeclaredMadeForKids).toBe('no');
    fireEvent.change(audience, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].selfDeclaredMadeForKids).toBeUndefined();
  });
});
