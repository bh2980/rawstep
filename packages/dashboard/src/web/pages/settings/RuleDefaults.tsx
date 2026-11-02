import { useTranslation } from 'react-i18next';
import { runRulesSchema } from '@rawstep/project/config';
import { RunRulesEditor } from '../../components/conditions/RunRulesEditor';

/**
 * 설정 › 기본 실행 규칙: the rules every new profile starts from. They are Rawstep's own defaults: the project has no layer of its own
 * between them and a profile, so they are shown, not edited, and a profile changes its copy under 실행 프로필 › 언제 멈추나요.
 */
export function RuleDefaults() {
  const { t } = useTranslation();
  return <div className="grid max-w-3xl gap-2">
    <p className="text-ink-2">{t('settingsPage.rules.intro')}</p>
    <RunRulesEditor readOnly value={{}} inherited={runRulesSchema.parse({})} />
  </div>;
}
