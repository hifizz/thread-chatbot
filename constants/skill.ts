// Skill（slash command）机制相关常量：触发字符、directive 类型、定义文件位置。

/** Composer 中唤起 skill 菜单的触发字符 */
export const SKILL_TRIGGER_CHAR = "/"

/** directive 语法 `:type[label]{name=id}` 中 skill 使用的 type */
export const SKILL_DIRECTIVE_TYPE = "skill"

/** skill 定义所在的项目根目录名（skills/<id>/SKILL.md） */
export const SKILLS_DIR = "skills"

/** 每个 skill 目录下的定义文件名 */
export const SKILL_FILE_NAME = "SKILL.md"
