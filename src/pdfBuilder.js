import { jsPDF } from "jspdf";

function eur(val) {
  var n = parseFloat(val);
  if (isNaN(n)) return "0,00 \u20AC";
  var fixed = n.toFixed(2);
  var parts = fixed.split(".");
  var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return intPart + "," + parts[1] + " \u20AC";
}

function dateFR(dateStr) {
  if (!dateStr) return "";
  var p = dateStr.split("-");
  return p[2] + "/" + p[1] + "/" + p[0].slice(2);
}

var W = 210, PAGE_H = 297, ML = 22, MR = 22, CW = W - ML - MR;
var DESC_X = ML + 4, DESC_W = 76, QTY_X = ML + 88, PRICE_X = ML + 120, AMT_X = ML + CW - 4;
var PAGE_USABLE_BOTTOM = 265, POST_TABLE_SPACE = 80;
var TEAL=[46,184,184],DARK=[51,51,51],GRAY=[102,102,102],LGRAY=[136,136,136],WHITE_=[255,255,255],BG=[245,245,245],LINE=[230,230,230];
function sc(d,c){d.setTextColor(c[0],c[1],c[2]);}

function drawTableHeader(doc, y) {
  doc.setFillColor(TEAL[0],TEAL[1],TEAL[2]);
  doc.rect(ML, y, CW, 10, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.setTextColor(WHITE_[0],WHITE_[1],WHITE_[2]);
  doc.text("Description", DESC_X, y+6.5);
  doc.text("Quantit\u00E9", QTY_X, y+6.5, {align:"center"});
  doc.text("Prix unitaire \u20AC", PRICE_X, y+6.5, {align:"center"});
  doc.text("Montant \u20AC", AMT_X, y+6.5, {align:"right"});
}

function drawFooter(doc, company) {
  var n = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= n; pg++) {
    doc.setPage(pg);
    doc.setDrawColor(210,210,210); doc.setLineWidth(0.3);
    doc.line(ML, 276, W-MR, 276);
    doc.setFont("helvetica","normal"); doc.setFontSize(8);
    sc(doc,LGRAY);
    doc.text(company.name+", "+company.address, W/2, 280, {align:"center"});
  }
}

export function buildInvoicePDF(company, invoice, totalTTC) {
  var doc = new jsPDF({unit:"mm",format:"a4"});
  var y = 25;

  // HEADER
  doc.setFont("helvetica","bold"); doc.setFontSize(11); sc(doc,DARK);
  doc.text(company.name, ML, y); y+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(9.5);
  doc.text(company.address, ML, y); y+=5;
  sc(doc,TEAL); doc.text(company.email, ML, y); y+=8;
  sc(doc,DARK); doc.text("IFU : "+company.ifu, ML, y); y+=4.5;
  doc.text("VMCF : "+company.vmcf, ML, y);

  doc.setFont("times","bold"); doc.setFontSize(30); sc(doc,GRAY);
  doc.text("FACTURE", W-MR, 30, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(10); sc(doc,LGRAY);
  doc.text(invoice.number, W-MR, 37, {align:"right"});

  // DIVIDER
  y=58; var steps=40;
  for(var i=0;i<steps;i++){var r=i/steps;doc.setDrawColor(Math.round(46+(204-46)*r),Math.round(184+(234-184)*r),Math.round(184+(234-184)*r));doc.setLineWidth(1);var sw=CW/steps;doc.line(ML+i*sw,y,ML+(i+1)*sw,y);}

  // CLIENT + DATE
  y+=10;
  doc.setFont("helvetica","italic"); doc.setFontSize(9.5); sc(doc,TEAL);
  doc.text("\u00C0 l\u2019attention de", ML, y);
  doc.setFont("helvetica","bold"); sc(doc,LGRAY);
  doc.text("Date", W-MR, y, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(10); sc(doc,DARK);
  doc.text(dateFR(invoice.date), W-MR, y+6, {align:"right"});

  var cy=y+6;
  if(invoice.clientName){doc.text(String(invoice.clientName),ML,cy);cy+=5;}
  if(invoice.clientAddress){doc.text(String(invoice.clientAddress),ML,cy);cy+=5;}
  if(invoice.clientCity){doc.text(String(invoice.clientCity),ML,cy);cy+=5;}

  // TABLE
  y=Math.max(cy+8,100);
  drawTableHeader(doc,y); y+=10;

  for(var idx=0;idx<invoice.items.length;idx++){
    var item=invoice.items[idx];
    var desc=item.description||"-";
    var descLines=doc.splitTextToSize(String(desc),DESC_W);
    var rowH=Math.max(10,descLines.length*5+5);
    var isLast=idx===invoice.items.length-1;
    if(y+(isLast?POST_TABLE_SPACE:rowH)>PAGE_USABLE_BOTTOM){doc.addPage();y=25;drawTableHeader(doc,y);y+=10;}
    doc.setFont("helvetica","normal");doc.setFontSize(9.5);sc(doc,DARK);
    doc.setDrawColor(LINE[0],LINE[1],LINE[2]);doc.setLineWidth(0.3);doc.line(ML,y+rowH,ML+CW,y+rowH);
    doc.text(descLines,DESC_X,y+6.5);
    doc.text(item.quantity?String(item.quantity):"-",QTY_X,y+6.5,{align:"center"});
    doc.text(item.unitPrice?eur(item.unitPrice):"-",PRICE_X,y+6.5,{align:"center"});
    var av=parseFloat(item.amount);doc.text(av>0?eur(av):"-",AMT_X,y+6.5,{align:"right"});
    y+=rowH;
  }

  // TOTAL
  if(y+POST_TABLE_SPACE>PAGE_USABLE_BOTTOM+10){doc.addPage();y=25;}
  y+=8;var tw=90,tx=ML+CW-tw;
  doc.setFillColor(BG[0],BG[1],BG[2]);doc.rect(tx,y,tw,12,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(85,85,85);
  doc.text("Total TTC",tx+6,y+8);
  doc.setFontSize(14);sc(doc,DARK);doc.text(eur(totalTTC),tx+tw-6,y+8.5,{align:"right"});
  y+=20;

  // CONDITIONS
  if(y+20>PAGE_USABLE_BOTTOM){doc.addPage();y=25;}
  doc.setFont("helvetica","bold");doc.setFontSize(10);sc(doc,TEAL);
  doc.text("Conditions",ML,y);y+=5;
  doc.setFont("helvetica","normal");doc.setFontSize(9.5);doc.setTextColor(85,85,85);
  doc.text(invoice.conditions||"Paiement \u00E0 r\u00E9ception",ML,y);y+=10;

  // PAYMENT
  if(y+20>PAGE_USABLE_BOTTOM){doc.addPage();y=25;}
  doc.setFont("helvetica","bold");doc.setFontSize(10);sc(doc,TEAL);
  doc.text("D\u00E9tails paiement",ML,y);y+=5;
  doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(85,85,85);
  var pl="Paypal : ";doc.text(pl,ML,y);
  doc.setFont("helvetica","normal");doc.text(company.paypal,ML+doc.getTextWidth(pl),y);

  // FOOTER on every page
  drawFooter(doc, company);

  return doc;
}
