import { trigger, state, style, animate, transition } from '@angular/animations';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ECodeStatus } from '../../../enums/ecode-status';
import { PdfService } from '../../../helpers/pdf.service';
import { FormDet } from '../../../interfaces/form-det';
import { ApiService } from '../../../services/api.service';
import { NgProgress } from 'ngx-progressbar';
import jwt_decode from "jwt-decode";

import { ProgressBarService } from '../../../services/progress-bar.service';
import { DomSanitizer } from '@angular/platform-browser';

import { jsPDF } from "jspdf";
import { File } from '../../../interfaces/file';
import { AlertsService } from '../../../services/alerts.service';

@Component({
  selector: 'app-form',
  templateUrl: './form.component.html',
  styleUrls: ['./form.component.scss'],
  animations: [
    trigger(
      'inOutAnimation',
      [
        transition(
          ':enter',
          [
            style({ height: 0, opacity: 0 }),
            animate('0.5s ease-out',
              style({ height: 62, opacity: 1 }))
          ]
        ),
        transition(
          ':leave',
          [
            style({ height: 62, opacity: 1 }),
            animate('0.5s ease-in',
              style({ height: 0, opacity: 0 }))
          ]
        )
      ]
    )
  ]
})
export class FormComponent implements OnInit {

  formName: string = '';
  formImage: string = '';
  formDet: any[] = [];
  formQuestions: any[] = [];
  listFiles: any[] = [];
  totalSizeFiles: number = 0;
  tab: any = null;
  indexParents: number = 1;
  formLoadingComplete: boolean = false;
  showCongratulations: boolean = false;
  showPreviewPdf: boolean = false;
  emailUser: string = '';
  pdfBase64: any;

  @ViewChild('container') container: ElementRef;
  @ViewChild('documentTemplate') documentTemplate: ElementRef;
  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private pdfService: PdfService,
    private progress: NgProgress,
    private loading: ProgressBarService,
    private sanitazer: DomSanitizer,
    private alertService: AlertsService
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe((res: any) => {
      if (res.tk) {
        localStorage.setItem('token', res.tk);
        let dataUser: any = jwt_decode(res.tk);
        this.emailUser = dataUser.sub;
        this.LoadFormByToken();
      } else {
        this.router.navigate(['/']);
      }
    })

    this.loading.progressRef = this.progress.ref('progressBar');
  }

  LoadFormByToken(): void {
    this.api.getFormByToken().subscribe(response => {
      let { status, data } = response;
      if (status == ECodeStatus.Ok) {
        this.formName = data.form.title;
        this.formImage = data.form.pathimg;
        this.formDet = data.formDet;
        let one = this.formDet.filter(e => e.ordernum == this.indexParents.toString());
        this.LoadFormDet(one[0].id);
      } else {
        this.router.navigate(['/']);
      }
    }, error => {
      if (error.status == 401) {
        this.router.navigate(['/']);
      }
    })
  }

  LoadFormDet(id: any): void {
    this.formLoadingComplete = true;
    this.api.getFormDet(id).subscribe(response => {
      let { status, data } = response;
      this.formLoadingComplete = false
      if (status == ECodeStatus.Ok) {
        this.indexParents++;
        this.formQuestions.push(data);
        this.VerifyNextTab([data])
      }
    })
  }

  VerifyNextTab(data: [any]): void {
    let find = data.filter(e => e.type == 'key')
    /** Valida si existe un key */
    if (find.length == 0) {
      /** No existen mas keys, cargar el siguiente padre */
      let one = this.formDet.filter(e => e.ordernum == this.indexParents.toString());
      if (one.length) {
        this.LoadFormDet(one[0].id);
      } else {
        /** Formulario cargado completo */
        console.info("Formulario cargado completamente");
        this.formLoadingComplete = true;
      }
    }
  }

  /** Events */

  onClickNextTab(): void {

    if (this.showPreviewPdf) {
      this.showCongratulations = true;
      this.showPreviewPdf = false;
      this.pdfService.generateDoc(this.formQuestions, false, this.formName, 'datauristring').then(data => {
        let dataSplit = data.split(',');
        this.pdfService.sendBase64(dataSplit[1]);
      })
    }

    if (this.tab == this.formQuestions.length && this.formLoadingComplete) {
      this.showPreviewPdf = true;
      this.pdfService.generateDoc(this.formQuestions, false, this.formName, 'datauristring').then(data => {
        this.pdfBase64 = this.sanitazer.bypassSecurityTrustResourceUrl(data);
      })
    }

    /** Validate tab */
    let validate = true;
    if (this.tab >= 0 && this.tab != null) {
      let dataToValidate = this.formQuestions[(this.tab - 1)];

      /* Validar si es clave */
      if (dataToValidate.type == 'key') {

        if (!dataToValidate.value) {
          dataToValidate.invalid = true;
          validate = false;
          return
        } else {
          dataToValidate.invalid = false;
          validate = true;
        }


        // Eliminar items despues de el, por si cambio  de opinion
        this.formQuestions.splice(this.tab, this.formQuestions.length);


        let ordernum: any = this.formDet.filter((e => e.keysId == dataToValidate.k_id));
        if (ordernum.length) {
          this.indexParents = ordernum[0].ordernum;
          this.indexParents++;
        } else {
          // recorrer la lista para saber cual fue el ultimo padre cargado, para saber que padre vendra (en caso de cambiar de opinion)
          this.formQuestions.forEach(e => {
            if (e.type == "key") {
              let found = this.formDet.filter(fd => fd.keysId == e.k_id);
              if (found.length) { this.indexParents = found[0].ordernum; this.indexParents++ }
            } else if (e.type == 'segment') {
              let found = this.formDet.filter(fd => fd.segmentsId == e.s_id);
              if (found.length) { this.indexParents = found[0].ordernum; this.indexParents++ }
            }
          })
        }

        this.formLoadingComplete = false;
        this.showCongratulations = false;

        if (dataToValidate.kt_name == "NUM_ENTERO") {

          dataToValidate.keys_opt.forEach(key_opt => {
            if (key_opt.ct_name == 'MENOR') {
              if (dataToValidate.value <= key_opt.ko_value) {
                this.onSelectOption(key_opt.ko_id)
              }
            }

            if (key_opt.ct_name == 'MENOR IGUAL') {
              if (dataToValidate.value <= key_opt.ko_value) {
                this.onSelectOption(key_opt.ko_id)
              }
            }

            if (key_opt.ct_name == 'MAYOR') {
              if (dataToValidate.value > key_opt.ko_value) {
                this.onSelectOption(key_opt.ko_id)
              }
            }

            if (key_opt.ct_name == 'MAYOR IGUAL') {
              if (dataToValidate.value >= key_opt.ko_value) {
                this.onSelectOption(key_opt.ko_id)
              }
            }
          });
        }

        if (dataToValidate.kt_name == 'OPC_UNICA') {
          let item = dataToValidate.keys_opt.filter(e => e.ko_id == dataToValidate.value)
          if (item.length) {
            this.onSelectOption(item[0].ko_id)
          }
        }
      }

      /* Validar cuando es segmento */
      if (dataToValidate.type == 'segment') {
        dataToValidate.segments_det.forEach(element => {
          if (element.qt_name != 'INFORMATIVA' && element.qt_name != 'INFORMATIVA_N') {
            if (element.qt_name == 'TABLA') {
              console.log(element);
              let totalRegist = parseInt(element.sd_tabnumcol) * parseInt(element.sd_tabnumrow);
              let countRegister = 0;
              let find = element.segments_det_tbl.findIndex(e => e.sdt_colname.replace(/\s+/g, '') == "%")
              let porcent = 0;
              let porcentValida = false;
              if (find >= 0) { console.log("Se encontro columna de porcentaje"); }
              if (element.sd_required) {
                element.table.forEach((row: any): any => {
                  
                  // Celdas
                  row.forEach((celd, index2) => {
                    console.log("Row",celd);
                    if (celd["value_" + index2]) {
                      countRegister++;
                    }

                    if (find == index2) {
                      porcent += (celd["value_" + find]) ? parseInt(celd["value_" + find]) : 0;
                    }
                  });

                });

                if(countRegister != totalRegist){
                  validate = false;
                  this.alertService.error("Debe llenar toda la tabla")
                }

                if (find >= 0) {
                  if (porcent == 100) {
                    porcentValida = true;
                  } else {
                    porcentValida = false;
                    element.valid = false;
                    validate = false;
                    this.alertService.error("El porcentaje debe cubrir el 100%");
                  }
                } else {
                  porcentValida = true;
                }
              }

            } else if (element.qt_name == 'OPC_UNICA' && element.segments_det_opt.filter(e => e.qt_name == 'TABLA').length) {
              if (element.sd_required) {
                element.segments_det_opt.forEach(seg_det_opt => {
                  if (seg_det_opt.qt_name == 'TABLA' && element.value == seg_det_opt.sdo_caption) {
                    let countRegister = 0;
                    let find = seg_det_opt.segments_det_opt_tbl.findIndex(e => e.sdot_colname.replace(/\s+/g, '') == "%")
                    let totalRegist = parseInt(seg_det_opt.sdo_tabnumcol) * parseInt(seg_det_opt.sdo_tabnumrow)
                    let porcent = 0;
                    let porcentValida = false;
                    seg_det_opt.table.forEach((row): any => {
                      //COLUMS                      
                      row.forEach((celd, index2) => {
                        if (celd["value_" + index2]) {
                          countRegister++;
                        }
    
                        if (find == index2) {
                          porcent += (celd["value_" + find]) ? parseInt(celd["value_" + find]) : 0;
                        }
                      });

                    });

                    if(countRegister != totalRegist){
                      validate = false;
                      this.alertService.error("Debe llenar toda la tabla")
                    }

                    if (find >= 0) {
                      if (porcent == 100) {
                        porcentValida = true;
                      } else {
                        porcentValida = false;
                        element.valid = false;
                        validate = false;
                        this.alertService.error("El porcentaje debe cubrir el 100%");
                      }
                    } else {
                      porcentValida = true;
                    }
                  } else {
                    if (!element.value && element.sd_required) {
                      element.invalid = true;
                      validate = false;
                    } else {
                      element.invalid = false;
                    }
                  }
                });
              }
            } else if (element.qt_name == 'OPC_MULTI') {
              element.segments_det_opt.forEach(seg_det_opt => {
                if (validate) { return }
                if (seg_det_opt.value) {
                  validate = true;
                } else {
                  validate = false;
                  element.invalid = true;
                }
              });

            } else if (element.qt_name == "SINO_JUST_SI") {
              if (element.sd_required && !element.value) {
                element.invalid = true;
                validate = false;
              } else {
                element.invalid = false;
              }

              if (element.sd_required && element.value == "SI") {
                element.segments_det_opt.forEach(seg_det_opt => {
                  if (!seg_det_opt.value) {
                    seg_det_opt.invalid = true;
                    validate = false;
                  }
                });
              }

            } else if (element.qt_name == "ARCHIVO") {
              if (element.sd_required) {
                let found = this.listFiles.find(e => e.id == element.sd_id);
                if (found) {
                  element.invalid = false;
                } else {
                  element.invalid = true;
                  validate = false;
                }
              }
            } else {

              if (!element.value && element.sd_required) {
                element.invalid = true;
                validate = false;
              } else {
                element.invalid = false;
              }
            }
          } else {
            element.invalid = false;
          }
        });
      }
    }

    if (validate) {
      if (this.tab) {
        this.tab++;
      } else {
        this.tab = 1;
      }
    } else {
      console.log("Pagina no valida");
    }
  }

  onClickPrevTab(): void {
    if (this.showPreviewPdf) {
      this.showPreviewPdf = false;
    }
    if (this.showCongratulations) {
      this.showCongratulations = false;
    }
    if (this.tab) {
      this.tab--;
    } else {
      this.tab = null;
    }
  }

  onSelectOption(id: any): void {
    this.loading.startLoading();
    this.api.getKeyOpt(id).subscribe(response => {
      let { status, data } = response;
      this.loading.completeLoading();
      if (status == ECodeStatus.Ok) {
        data.forEach((element: any) => {
          this.formQuestions.push(element)
        });
        this.VerifyNextTab(data)
      } else {
        this.VerifyNextTab([{ type: false }])
      }
    })
  }

  createArray(rows: any, colums: any) {
    let array = [];

    for (let i = 0; i < rows; i++) {
      let arrayCol = [];
      for (let j = 0; j < colums; j++) {
        arrayCol.push({ value: '' });
      }
      array.push(arrayCol);
    }

    return array;
  }

  onChangeSinoJustSi(indexQuestion: any, indexSegDet: any, condition: string): void {

    if (condition == 'SI') {
      if (this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt.filter(e => e.qt_name == 'EMAIL').length) {
        let index = this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt.findIndex(e => e.qt_name == 'EMAIL')
        this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt[index].value = this.emailUser
      }
    } else {
      if (this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt.filter(e => e.qt_name == 'EMAIL').length) {
        let index = this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt.findIndex(e => e.qt_name == 'EMAIL')
        this.formQuestions[indexQuestion].segments_det[indexSegDet].segments_det_opt[index].value = null;
      }
    }
  }

  uploadFile(data: File, seg_det): void {
    // Validar si no pasa el tamaño maximo
    if ((this.totalSizeFiles + data.size) <= 12000000) {
      // Agregar a la lista
      this.listFiles.push({
        id: seg_det.sd_id,
        base64: data.base64Sort,
        ext: data.ext,
        size: data.size
      })
      seg_det.value = data.name;
      // Sumar el nuevo archivo al tamaño maximo
      this.totalSizeFiles += data.size;
    } else {
      this.alertService.error("Tamaño maximo superado");
    }
  }

  onClickDeleteFile(seg_det: any): void {
    let id = seg_det.sd_id;
    let newFiles = this.listFiles.filter(e => e.id !== id);
    this.listFiles = newFiles;
    seg_det.value = null;
  }

}
