import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"

import { getSkillSettings, updateSkillSettings, type SkillSettings } from "@/features/settings/settingsApi"
import { getSkillContent, listSkills, setSkillGroup, type SkillInfo } from "@/features/studio/studioApi"
import {
  AdaptiveResourceLayout,
  DetailLayout,
  GroupedCompactResourceList,
  ResourceCard,
  ResourceGrid,
  ResourceManagementLayout,
  StatusText,
  countBy,
  filterOptionsFromCounts,
  matchesQuery,
} from "@/shared/components/ResourceManagement"
import { themeClassNames } from "@/shared/theme/classes"

export function SkillsPage() {
  const queryClient = useQueryClient()
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: listSkills })
  const skillSettingsQuery = useQuery({ queryKey: ["settings", "skill"], queryFn: getSkillSettings })
  const skillSettingsMutation = useMutation({
    mutationFn: updateSkillSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(["settings", "skill"], next)
      void queryClient.invalidateQueries({ queryKey: ["skills"] })
      void queryClient.invalidateQueries({ queryKey: ["studio", "skills"] })
    },
  })

  const skills = skillsQuery.data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const groupOptions = useMemo(() => filterOptionsFromCounts(countBy(skills, (skill) => skill.group || "default"), skills.length), [skills])
  const filtered = useMemo(
    () =>
      skills.filter((skill) => {
        const group = skill.group || "default"
        if (activeGroup && group !== activeGroup) return false
        return matchesQuery(
          [
            skill.skill_id,
            skill.name,
            skill.description,
            skill.directory_path,
            skill.license,
            skill.compatibility,
            skill.allowed_tools,
            group,
            skill.metadata?.["display-name"],
            skill.metadata?.version,
          ],
          search,
        )
      }),
    [activeGroup, search, skills],
  )

  const selected = skills.find((skill) => skill.skill_id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5">
        <SkillRepositorySettingsCard
          settings={skillSettingsQuery.data}
          isLoading={skillSettingsQuery.isLoading}
          error={skillSettingsQuery.error}
          saving={skillSettingsMutation.isPending}
          saveError={skillSettingsMutation.error}
          onSave={(skillsDir) => skillSettingsMutation.mutate({ skills_dir: skillsDir })}
        />
      </div>
      <div className="min-h-0 flex-1">
        {selected ? (
          <AdaptiveResourceLayout
            list={
              <GroupedCompactResourceList
                items={filtered.length > 0 ? filtered : skills}
                selectedKey={selected.skill_id}
                onSelect={(skill) => setSelectedId(skill.skill_id)}
                getKey={(skill) => skill.skill_id}
                getTitle={(skill) => skill.metadata?.["display-name"] || skill.name}
                getGroup={(skill) => skill.group || "default"}
                onBack={() => setSelectedId(null)}
              />
            }
            detail={<SkillDetailView key={selected.skill_id} skill={selected} />}
          />
        ) : (
          <ResourceManagementLayout
            count={skills.length}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="搜索 Skill 名称 / ID / 描述 / 分组..."
            primaryFilters={groupOptions}
            activePrimary={activeGroup}
            onPrimaryChange={setActiveGroup}
          >
            <StatusText isLoading={skillsQuery.isLoading} error={skillsQuery.error} empty={!skillsQuery.isLoading && !skillsQuery.error && filtered.length === 0} />
            <ResourceGrid>
              {filtered.map((skill) => (
                <ResourceCard
                  key={skill.skill_id}
                  title={skill.metadata?.["display-name"] || skill.name}
                  identifier={
                    <span>
                      {skill.skill_id}{skill.metadata?.version ? `  v${skill.metadata.version}` : ""}
                    </span>
                  }
                  description={skill.description}
                  badges={
                    <>
                      <span className="rounded-full bg-app-surface/70 px-2 py-0.5 text-[10px] text-app-muted">{skill.group || "default"}</span>
                      {skill.compatibility && <span className="truncate text-[10px] text-app-secondary">{skill.compatibility}</span>}
                    </>
                  }
                  onClick={() => setSelectedId(skill.skill_id)}
                />
              ))}
            </ResourceGrid>
          </ResourceManagementLayout>
        )}
      </div>
    </div>
  )
}

function SkillRepositorySettingsCard({
  settings,
  isLoading,
  error,
  saving,
  saveError,
  onSave,
}: {
  settings: SkillSettings | undefined
  isLoading: boolean
  error: unknown
  saving: boolean
  saveError: unknown
  onSave: (skillsDir: string) => void
}) {
  const [skillsDir, setSkillsDir] = useState("")

  useEffect(() => {
    if (!settings) return
    setSkillsDir(settings.skills_dir)
  }, [settings])

  const dirty = settings ? skillsDir !== settings.skills_dir : false
  const validationError = !skillsDir.trim() ? "Skill 根目录不能为空。" : null

  return (
    <section className="mb-3">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-app-primary">Skill 根目录</h2>
        <p className="mt-1 truncate text-xs text-app-muted">包含各个 Skill 子目录，保存后立即重新扫描。</p>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-app-secondary">
          <Loader2 size={16} className="animate-spin" />
          正在加载 Skill 根目录
        </div>
      ) : error || !settings ? (
        <div className={themeClassNames.state.dangerAlert}>{getErrorMessage(error, "Skill 根目录加载失败。")}</div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Skill 根目录"
              value={skillsDir}
              onChange={(event) => setSkillsDir(event.target.value)}
              className={`${themeClassNames.form.input} h-10 min-w-0 flex-1 px-3 font-mono text-sm`}
            />
            <button
              type="button"
              disabled={!dirty || saving || Boolean(validationError)}
              onClick={() => onSave(skillsDir.trim())}
              className={`${themeClassNames.button.primaryCompact} h-10 shrink-0 gap-1.5`}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存
            </button>
          </div>
          {validationError ? <div className={themeClassNames.state.warningAlert}>{validationError}</div> : null}
          {saveError ? <div className={themeClassNames.state.dangerAlert}>{getErrorMessage(saveError, "Skill 根目录保存失败。")}</div> : null}
        </div>
      )}
    </section>
  )
}

function SkillDetailView({ skill }: { skill: SkillInfo }) {
  const qc = useQueryClient()
  const [editingGroup, setEditingGroup] = useState(false)
  const [groupDraft, setGroupDraft] = useState(skill.group || "default")

  const groupMut = useMutation({
    mutationFn: () => setSkillGroup(skill.skill_id, groupDraft.trim() || "default"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skills"] })
      void qc.invalidateQueries({ queryKey: ["studio", "skills"] })
      setEditingGroup(false)
    },
  })

  const { data: contentData, isLoading: contentLoading, error: contentError } = useQuery({
    queryKey: ["skill-content", skill.skill_id],
    queryFn: () => getSkillContent(skill.skill_id),
  })

  return (
    <DetailLayout
      title={skill.metadata?.["display-name"] || skill.name}
      identifier={skill.skill_id}
    >
      <div className="space-y-6 pb-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 rounded-lg border border-app-border/80 bg-app-surface/70 p-5 text-xs lg:grid-cols-4">
          <div>
            <dt className="text-app-muted">分组</dt>
            <dd className="mt-0.5">
              {editingGroup ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="w-32 rounded border border-app-border-strong bg-app-surface/70 px-2 py-1 text-xs text-app-primary outline-none focus:border-app-accent"
                    value={groupDraft}
                    onChange={(event) => setGroupDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") groupMut.mutate()
                      if (event.key === "Escape") setEditingGroup(false)
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => groupMut.mutate()}
                    disabled={groupMut.isPending}
                    className={themeClassNames.button.primaryCompact}
                  >
                    保存
                  </button>
                  <button type="button" onClick={() => setEditingGroup(false)} className="text-xs text-app-muted hover:text-app-secondary">
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="group text-left text-app-secondary hover:text-app-accent"
                  onClick={() => {
                    setGroupDraft(skill.group || "default")
                    setEditingGroup(true)
                  }}
                >
                  {skill.group || "default"}
                  <span className="ml-2 font-semibold text-blue-600 group-hover:text-blue-700">编辑</span>
                </button>
              )}
            </dd>
          </div>
          {skill.metadata?.version && <MetaField label="版本" value={`v${skill.metadata.version}`} />}
          {skill.license && <MetaField label="许可" value={skill.license} />}
          {skill.compatibility && <MetaField label="兼容性" value={skill.compatibility} />}
          <div className="col-span-2 lg:col-span-4">
            <MetaField label="描述" value={skill.description} />
          </div>
          <div className="col-span-2 lg:col-span-4">
            <MetaField label="目录" value={skill.directory_path} mono />
          </div>
          {skill.allowed_tools && (
            <div className="col-span-2 lg:col-span-4">
              <MetaField label="允许的工具" value={skill.allowed_tools} mono />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-app-border/80 bg-app-surface/70 p-6">
          <h3 className="mb-4 text-sm font-medium text-app-secondary">SKILL.md</h3>
          {contentLoading && <div className="text-xs text-app-muted">加载中</div>}
          {contentError && <div className="text-xs text-app-danger">加载失败</div>}
          {contentData?.content && (
            <div className="prose prose-invert max-w-none text-sm leading-relaxed text-app-secondary [&_a]:text-blue-400 [&_a]:no-underline hover:[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-app-border-strong [&_blockquote]:pl-4 [&_blockquote]:text-app-secondary [&_code]:rounded [&_code]:bg-app-surface/70 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-app-primary [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-app-primary [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-app-primary [&_hr]:border-app-border/80 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:rounded-lg [&_pre]:bg-[#1a1b1e] [&_pre]:p-4 [&_pre]:text-xs [&_table]:text-xs [&_td]:px-3 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-app-border/80 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown>{contentData.content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </DetailLayout>
  )
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-app-muted">{label}</dt>
      <dd className={`mt-0.5 break-all text-app-secondary ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
