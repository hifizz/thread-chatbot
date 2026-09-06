"""生成最小 OOXML 回归样本；PPT 页序与备注编号故意不一致。仅用 Python 标准库。"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).parent
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'

def archive(name, parts):
    with ZipFile(root / name, 'w', ZIP_DEFLATED) as z:
        for path, text in parts.items():
            z.writestr(path, text)

def rels(*items):
    return f'<Relationships xmlns="{REL}">' + ''.join(
        f'<Relationship Id="{id}" Type="{R}/{kind}" Target="{target}"/>'
        for id, kind, target in items) + '</Relationships>'

archive('office-word.docx', {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': rels(('rId1', 'officeDocument', 'word/document.xml')),
    'word/document.xml': f'''<w:document xmlns:w="{W}"><w:body>
<w:p><w:r><w:t>中文办公报告 &amp; 安全字符</w:t></w:r></w:p>
<w:p><w:r><w:t>项目预算见表格</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>预算A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>''',
    'word/footnotes.xml': f'<w:footnotes xmlns:w="{W}"><w:footnote w:id="1"><w:p><w:r><w:t>预算脚注：单位为元</w:t></w:r></w:p></w:footnote></w:footnotes>',
    'word/_rels/document.xml.rels': rels(('rId2', 'footnotes', 'footnotes.xml')),
})

def slide(text):
    return f'<p:sld xmlns:p="{P}" xmlns:a="{A}" xmlns:r="{R}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'

def note(text):
    return slide(text).replace('p:sld', 'p:notes')

archive('office-slides.pptx', {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    'ppt/presentation.xml': f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels(('rId1', 'slide', 'slides/slide1.xml'), ('rId2', 'slide', 'slides/slide2.xml')),
    'ppt/slides/slide1.xml': slide('第二页：详细预算'),
    'ppt/slides/slide2.xml': slide('第一页：方案总览'),
    'ppt/slides/_rels/slide1.xml.rels': rels(('rId9', 'notesSlide', '../notesSlides/notesSlide7.xml')),
    'ppt/slides/_rels/slide2.xml.rels': rels(('rId8', 'notesSlide', '../notesSlides/notesSlide3.xml')),
    'ppt/notesSlides/notesSlide7.xml': note('第二页备注：预算上限1200'),
    'ppt/notesSlides/notesSlide3.xml': note('第一页备注：只介绍目标'),
})
archive('office-wrong-type.docx', {'not-office.txt': 'This is a ZIP, not a Word document'})
archive('office-entity.docx', {'word/document.xml': '<!DOCTYPE a [<!ENTITY x "expand">]><a>&x;</a>'})
